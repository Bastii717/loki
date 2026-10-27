import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { eq, like } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setAvatar } from '../../../lib/server/avatar';
import { db } from '../../../lib/server/db';
import { auditLog, users } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { timeOut, userWithSession } from '../../../lib/server/moderation-test-utils';
import { env } from '../../../lib/server/env';
import { setDisplayName, setMotto } from '../../../lib/server/profile';
import { deleteObjects, s3Client } from '../../../lib/server/storage';
import { ensureBucket } from '../../../lib/server/storage-test-utils';
import { actions, load } from './+page.server';

type User = Awaited<ReturnType<typeof userWithSession>>['user'];
type Failure = { status: number; data: { error: string; displayName: string; motto: string } };

const created: string[] = [];
let png: Buffer;

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#0a0' } })
		.png()
		.toBuffer();
});
beforeEach(resetDb);
afterAll(async () => {
	if (created.length) await deleteObjects(created);
});

/** `avatar`: a Buffer is sent as a file; '' sends the empty file a browser submits with no choice. */
async function save(user: User, fields: Record<string, string>, avatar?: Buffer | '') {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	if (avatar !== undefined) {
		body.set(
			'avatar',
			avatar === ''
				? new File([], '')
				: new File([new Uint8Array(avatar)], 'a.png', { type: 'image/png' })
		);
	}
	const request = new Request('https://loki.test/profile/edit', { method: 'POST', body });
	return (await actions.save({ request, locals: { user } } as never)) as { saved: true } | Failure;
}

const exists = (Key: string) =>
	s3Client()
		.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }))
		.then(
			() => true,
			() => false
		);

const mottoAudits = async () =>
	(await db.select().from(auditLog).where(like(auditLog.action, 'motto_%'))).length;

const row = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

describe('actions', () => {
	it('only exposes named actions', () => {
		expect(Object.keys(actions).sort()).toEqual(['removeAvatar', 'save']);
	});

	it('sets a display name and a motto', async () => {
		const { user } = await userWithSession();
		expect(await save(user, { displayName: 'Lena K', motto: 'Memes first' })).toEqual({
			saved: true
		});
		const r = await row(user.id);
		expect(r.displayName).toBe('Lena K');
		expect(r.motto).toBe('Memes first');
	});

	it('keeps an existing name when the field is empty or unchanged, and still saves the motto', async () => {
		const { user } = await userWithSession();
		await setDisplayName(user, user.id, 'Lena K');
		const before = await row(user.id);
		const named = { ...user, displayName: 'Lena K' };
		expect(await save(named, { displayName: '', motto: 'one' })).toEqual({ saved: true });
		expect(await save(named, { displayName: 'Lena K', motto: 'two' })).toEqual({ saved: true });
		const after = await row(user.id);
		expect(after.displayName).toBe('Lena K');
		expect(after.displayNameChangedAt).toEqual(before.displayNameChangedAt);
		expect(after.motto).toBe('two');
	});

	it('clears the motto with an empty field', async () => {
		const { user } = await userWithSession();
		await save(user, { displayName: '', motto: 'hello' });
		expect(await save(user, { displayName: '', motto: '' })).toEqual({ saved: true });
		expect((await row(user.id)).motto).toBe('');
	});

	it('rejects a taken name with 400 and echoes the input', async () => {
		const { user: other } = await userWithSession();
		await setDisplayName(other, other.id, 'Lena K');
		const { user } = await userWithSession();
		const result = (await save(user, { displayName: 'lena_k', motto: 'hi' })) as Failure;
		expect(result.status).toBe(400);
		expect(result.data).toEqual({
			error: 'That name is taken.',
			displayName: 'lena_k',
			motto: 'hi'
		});
		expect((await row(user.id)).motto).toBe('');
	});

	it('rejects an invalid name with the format message', async () => {
		const { user } = await userWithSession();
		const result = (await save(user, { displayName: '!', motto: '' })) as Failure;
		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/^Pick 2 to 24 characters/);
	});

	it('rejects a rename during the cooldown with the date', async () => {
		const { user } = await userWithSession();
		await setDisplayName(user, user.id, 'Lena K');
		const named = { ...user, displayName: 'Lena K' };
		const result = (await save(named, { displayName: 'Other Name', motto: '' })) as Failure;
		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/^You can change your name again on .+\.$/);
		expect((await row(user.id)).displayName).toBe('Lena K');
	});

	it('rejects a motto that is too long', async () => {
		const { user } = await userWithSession();
		const result = (await save(user, { displayName: '', motto: 'x'.repeat(81) })) as Failure;
		expect(result.status).toBe(400);
		expect(result.data.error).toBe('The motto can have at most 80 characters.');
		expect(result.data.motto).toHaveLength(81);
	});

	it('answers a timed-out member with 403 and the timeout message', async () => {
		const { user } = await userWithSession();
		await timeOut(user.id, user.id);
		const result = (await save(user, { displayName: 'Lena K', motto: 'hi' })) as Failure;
		expect(result.status).toBe(403);
		expect(result.data.error).toMatch(/^You are muted until .+: test$/);
		expect(result.data.displayName).toBe('Lena K');
	});

	it('uploads an avatar after the name and the motto', async () => {
		const { user } = await userWithSession();
		expect(await save(user, { displayName: 'Lena K', motto: 'hi' }, png)).toEqual({ saved: true });
		const r = await row(user.id);
		expect(r.avatarKey).toMatch(new RegExp(`^avatars/u${user.id}/.+-256\\.webp$`));
		created.push(r.avatarKey!, r.avatarThumbKey!);
		expect(r.displayName).toBe('Lena K');
		expect(r.motto).toBe('hi');
	});

	it('ignores an empty file input', async () => {
		const { user } = await userWithSession();
		expect(await save(user, { displayName: '', motto: 'hi' }, '')).toEqual({ saved: true });
		expect((await row(user.id)).avatarKey).toBeNull();
	});

	it('rejects a file that is not an image and keeps the typed values', async () => {
		const { user } = await userWithSession();
		const result = (await save(
			user,
			{ displayName: '', motto: 'hi' },
			Buffer.from('nope')
		)) as Failure;
		expect(result.status).toBe(400);
		expect(result.data.error).toBe('Unsupported file type. Use a JPEG, PNG or WebP image.');
		expect(result.data.motto).toBe('hi');
	});

	it('removes the avatar and deletes both objects', async () => {
		const { user } = await userWithSession();
		const keys = await setAvatar(user, png);
		created.push(keys.avatarKey, keys.avatarThumbKey);
		expect(await exists(keys.avatarKey)).toBe(true);
		expect(await actions.removeAvatar({ locals: { user } } as never)).toEqual({ removed: true });
		expect((await row(user.id)).avatarKey).toBeNull();
		expect(await exists(keys.avatarKey)).toBe(false);
		expect(await exists(keys.avatarThumbKey)).toBe(false);
	});

	it('lets a muted member remove the avatar', async () => {
		const { user } = await userWithSession();
		const keys = await setAvatar(user, png);
		created.push(keys.avatarKey, keys.avatarThumbKey);
		await timeOut(user.id, user.id);
		expect(await actions.removeAvatar({ locals: { user } } as never)).toEqual({ removed: true });
		expect((await row(user.id)).avatarKey).toBeNull();
	});

	it('lets a muted member clear the motto through save', async () => {
		const { user } = await userWithSession();
		await setMotto(user, 'hello');
		await timeOut(user.id, user.id);
		expect(await save(user, { displayName: '', motto: '' })).toEqual({ saved: true });
		expect((await row(user.id)).motto).toBe('');
	});

	it('still refuses a muted member a new motto', async () => {
		const { user } = await userWithSession();
		await timeOut(user.id, user.id);
		const result = (await save(user, { displayName: '', motto: 'new' })) as Failure;
		expect(result.status).toBe(403);
	});

	it('writes no motto audit row when the motto is unchanged', async () => {
		const { user } = await userWithSession();
		// no motto stored, avatar only
		expect(await save(user, { displayName: '', motto: '' }, png)).toEqual({ saved: true });
		const r = await row(user.id);
		created.push(r.avatarKey!, r.avatarThumbKey!);
		expect(await mottoAudits()).toBe(0);
		// same motto twice: one row
		await save(user, { displayName: '', motto: 'same' });
		await save(user, { displayName: '', motto: ' same ' });
		expect(await mottoAudits()).toBe(1);
	});
});

describe('load', () => {
	type LoadData = {
		profile: { username: string; displayName: string | null; motto: string };
		nextRenameAt: string | null;
		setByAdmin: boolean;
		isAdmin: boolean;
	};
	const loadAs = (user: User) => load({ locals: { user } } as never) as Promise<LoadData>;

	it('returns no cooldown for a member who never renamed', async () => {
		const { user } = await userWithSession();
		const data = await loadAs(user);
		expect(data.nextRenameAt).toBeNull();
		expect(data.profile).toMatchObject({ username: user.username, displayName: null, motto: '' });
	});

	it('reports whether an admin set the name, never for a self-chosen one', async () => {
		const admin = await userWithSession('admin');
		const { user } = await userWithSession();
		expect((await loadAs(user)).setByAdmin).toBe(false);
		await setDisplayName(admin.user, user.id, 'Set By Admin');
		expect((await loadAs(user)).setByAdmin).toBe(true);
		expect((await loadAs(user)).isAdmin).toBe(false);
		expect((await loadAs(admin.user)).isAdmin).toBe(true);
	});

	it('never locks the name for an admin, even after a recent rename', async () => {
		const { user } = await userWithSession('admin');
		await setDisplayName(user, user.id, 'Boss Lena');
		expect((await loadAs(user)).nextRenameAt).toBeNull();
	});

	it('returns the end of the cooldown as an ISO date after a rename', async () => {
		const { user } = await userWithSession();
		await setDisplayName(user, user.id, 'Lena K');
		const data = await loadAs(user);
		expect(data.profile.displayName).toBe('Lena K');
		const days = (new Date(data.nextRenameAt!).getTime() - Date.now()) / 86_400_000;
		expect(days).toBeGreaterThan(29.9);
		expect(days).toBeLessThanOrEqual(30);
	});
});
