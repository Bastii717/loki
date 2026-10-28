import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarError, avatarErrorMessage, avatarKeys, removeAvatar, setAvatar } from './avatar';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { auditLog, notifications, timeouts, users } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { env } from './env';
import { TimeoutActiveError } from './moderation';
import { ProfileInputError } from './profile';
import * as storage from './storage';
import { ensureBucket } from './storage-test-utils';

const exists = (Key: string) =>
	storage
		.s3Client()
		.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }))
		.then(
			() => true,
			() => false
		);

const asSession = (u: {
	id: number;
	username: string;
	role: SessionUser['role'];
}): SessionUser => ({
	id: u.id,
	username: u.username,
	displayName: null,
	role: u.role
});

const created: string[] = [];
let jpegExif: Buffer;
let png: Buffer;
let webp: Buffer;
let gif: Buffer;

const solid = (width = 800, height = 600) =>
	sharp({ create: { width, height, channels: 3, background: '#f00' } });

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	jpegExif = await solid().jpeg().withMetadata({ orientation: 6 }).toBuffer();
	png = await solid(300, 500).png().toBuffer();
	webp = await solid(120, 120).webp().toBuffer();
	gif = await solid(100, 100).gif().toBuffer();
});

beforeEach(resetDb);

afterEach(() => {
	vi.restoreAllMocks();
});

afterAll(async () => {
	if (created.length) await storage.deleteObjects(created);
});

async function avatarRow(userId: number) {
	const [row] = await db
		.select({ avatarKey: users.avatarKey, avatarThumbKey: users.avatarThumbKey })
		.from(users)
		.where(eq(users.id, userId));
	return row;
}

async function audits(action: string) {
	return (await db.select().from(auditLog)).filter((a) => a.action === action);
}

async function noticesOf(userId: number) {
	return db.select().from(notifications).where(eq(notifications.userId, userId));
}

async function fetchBuf(key: string): Promise<Buffer> {
	const res = await fetch(await storage.getPresignedUrl(key, 60));
	return Buffer.from(await res.arrayBuffer());
}

async function setAndTrack(actor: SessionUser, file: Buffer) {
	const keys = await setAvatar(actor, file);
	created.push(keys.avatarKey, keys.avatarThumbKey);
	return keys;
}

describe('avatarKeys', () => {
	it('shares one uuid between both keys', () => {
		const { key, thumbKey } = avatarKeys();
		const m = /^avatars\/([0-9a-f-]{36})-256\.webp$/.exec(key);
		expect(m).not.toBeNull();
		expect(thumbKey).toBe(`avatars/${m![1]}-64.webp`);
	});

	it('carries no user segment and is fresh on every call', () => {
		const a = avatarKeys();
		expect(a.key).not.toMatch(/\/u\d+\//);
		expect(avatarKeys().key).not.toBe(a.key);
	});
});

describe('avatarErrorMessage', () => {
	it('returns the three spec messages', () => {
		expect(avatarErrorMessage(new AvatarError('type'))).toBe(
			'Unsupported file type. Use a JPEG, PNG or WebP image.'
		);
		expect(avatarErrorMessage(new AvatarError('size'))).toBe(
			`Image is too large (max ${env.AVATAR_MAX_MB} MB).`
		);
		expect(avatarErrorMessage(new AvatarError('process'))).toBe(
			'That image could not be processed.'
		);
	});
});

describe('setAvatar', () => {
	it.each([
		['a JPEG with EXIF orientation', () => jpegExif],
		['a PNG', () => png],
		['a WebP', () => webp]
	])('stores a 256 and a 64 pixel WebP for %s', async (_name, input) => {
		const user = await testUser();
		const { avatarKey, avatarThumbKey } = await setAndTrack(asSession(user), input());

		expect(avatarKey).toMatch(/^avatars\/[0-9a-f-]{36}-256\.webp$/);
		expect(avatarThumbKey).toBe(avatarKey.replace('-256.webp', '-64.webp'));

		for (const [key, size] of [
			[avatarKey, 256],
			[avatarThumbKey, 64]
		] as const) {
			const meta = await sharp(await fetchBuf(key)).metadata();
			expect(meta.format).toBe('webp');
			expect([meta.width, meta.height]).toEqual([size, size]);
			expect(meta.exif).toBeUndefined();
		}
		expect(await avatarRow(user.id)).toEqual({ avatarKey, avatarThumbKey });
	});

	it('applies the EXIF orientation before cropping', async () => {
		// stored 800x600: left half red, right half blue; orientation 6 rotates it 90 degrees clockwise,
		// so the red left half ends up on top
		const left = await sharp({
			create: { width: 400, height: 600, channels: 3, background: '#f00' }
		})
			.png()
			.toBuffer();
		const right = await sharp({
			create: { width: 400, height: 600, channels: 3, background: '#00f' }
		})
			.png()
			.toBuffer();
		const input = await sharp({
			create: { width: 800, height: 600, channels: 3, background: '#000' }
		})
			.composite([
				{ input: left, left: 0, top: 0 },
				{ input: right, left: 400, top: 0 }
			])
			.jpeg({ quality: 100 })
			.withMetadata({ orientation: 6 })
			.toBuffer();

		const user = await testUser();
		const { avatarKey } = await setAndTrack(asSession(user), input);
		const { data, info } = await sharp(await fetchBuf(avatarKey))
			.raw()
			.toBuffer({ resolveWithObject: true });
		const px = (x: number, y: number) => {
			const i = (y * info.width + x) * info.channels;
			return [data[i], data[i + 1], data[i + 2]];
		};
		const upper = px(128, 20);
		const lower = px(128, 235);
		expect(upper[0]).toBeGreaterThan(200);
		expect(upper[2]).toBeLessThan(60);
		expect(lower[2]).toBeGreaterThan(200);
		expect(lower[0]).toBeLessThan(60);
	});

	it('rejects a GIF, an MP4 and an SVG as type without storing anything', async () => {
		const user = await testUser();
		const put = vi.spyOn(storage, 'putObject');
		const mp4 = Buffer.concat([Buffer.from('00000018667479706d703432', 'hex'), Buffer.alloc(64)]);
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
		);
		for (const input of [gif, mp4, svg, Buffer.from('plain text')]) {
			await expect(setAvatar(asSession(user), input)).rejects.toMatchObject({ code: 'type' });
		}
		await expect(setAvatar(asSession(user), gif)).rejects.toBeInstanceOf(AvatarError);
		expect(put).not.toHaveBeenCalled();
		expect(await avatarRow(user.id)).toEqual({ avatarKey: null, avatarThumbKey: null });
	});

	it('rejects a 9 MB body as size before looking at its content', async () => {
		const user = await testUser();
		const put = vi.spyOn(storage, 'putObject');
		await expect(setAvatar(asSession(user), Buffer.alloc(9 * 1024 * 1024))).rejects.toMatchObject({
			code: 'size'
		});
		expect(put).not.toHaveBeenCalled();
	});

	it('rejects a corrupt JPEG as process without storing anything', async () => {
		const user = await testUser();
		const put = vi.spyOn(storage, 'putObject');
		const corrupt = Buffer.concat([
			Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
			Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 37 + 11) % 256))
		]);
		await expect(setAvatar(asSession(user), corrupt)).rejects.toMatchObject({ code: 'process' });
		expect(put).not.toHaveBeenCalled();
		expect(await avatarRow(user.id)).toEqual({ avatarKey: null, avatarThumbKey: null });
	});

	it('records an audit entry with the new key', async () => {
		const user = await testUser();
		const { avatarKey } = await setAndTrack(asSession(user), png);
		const rows = await audits('avatar_changed');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: user.id,
			targetType: 'user',
			targetId: user.id,
			detail: `key=${avatarKey}`
		});
	});

	it('deletes the previous two objects after replacing', async () => {
		const user = await testUser();
		const first = await setAndTrack(asSession(user), png);
		expect(await exists(first.avatarKey)).toBe(true);
		expect(await exists(first.avatarThumbKey)).toBe(true);

		const second = await setAndTrack(asSession(user), webp);
		expect(second.avatarKey).not.toBe(first.avatarKey);
		expect(await exists(first.avatarKey)).toBe(false);
		expect(await exists(first.avatarThumbKey)).toBe(false);
		expect(await exists(second.avatarKey)).toBe(true);
		expect(await avatarRow(user.id)).toEqual(second);
	});

	it('does not touch the old objects when the row update fails', async () => {
		const user = await testUser();
		const first = await setAndTrack(asSession(user), png);
		const put = vi.spyOn(storage, 'putObject');
		const del = vi.spyOn(storage, 'deleteObjects');
		// a nonexistent actor makes the audit insert fail its foreign key inside the transaction
		const ghost = { ...asSession(user), id: user.id + 1000 };
		await expect(setAvatar(ghost, png)).rejects.toThrow();

		const uploaded = put.mock.calls.map((c) => c[0]);
		expect(uploaded).toHaveLength(2);
		expect(uploaded).not.toContain(first.avatarKey);
		// exactly one delete call: the freshly uploaded pair, never the stored one
		expect(del).toHaveBeenCalledTimes(1);
		expect([...del.mock.calls[0][0]].sort()).toEqual([...uploaded].sort());
		for (const key of uploaded) expect(await exists(key)).toBe(false);
		expect(await exists(first.avatarKey)).toBe(true);
		expect(await exists(first.avatarThumbKey)).toBe(true);
		expect(await avatarRow(user.id)).toEqual(first);
	});

	it('removes the first upload and leaves the row alone when the second put fails', async () => {
		const user = await testUser();
		const first = await setAndTrack(asSession(user), png);
		const realPut = storage.putObject;
		const put = vi
			.spyOn(storage, 'putObject')
			.mockImplementationOnce(realPut)
			.mockRejectedValueOnce(new Error('s3 put failed'));
		const del = vi.spyOn(storage, 'deleteObjects');

		// the storage error is rethrown as is, it is not an AvatarError
		await expect(setAvatar(asSession(user), webp)).rejects.toThrow('s3 put failed');

		expect(put).toHaveBeenCalledTimes(2);
		const [firstKey, secondKey] = put.mock.calls.map((c) => c[0]);
		expect(del).toHaveBeenCalledTimes(1);
		expect([...del.mock.calls[0][0]].sort()).toEqual([firstKey, secondKey].sort());
		expect(await exists(firstKey)).toBe(false);
		expect(await exists(first.avatarKey)).toBe(true);
		expect(await avatarRow(user.id)).toEqual(first);
		expect(await audits('avatar_changed')).toHaveLength(1);
	});

	it('still succeeds when deleting the old objects fails', async () => {
		const user = await testUser();
		await setAndTrack(asSession(user), png);
		vi.spyOn(storage, 'deleteObjects').mockRejectedValue(new Error('s3 down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const second = await setAndTrack(asSession(user), webp);
		expect(await avatarRow(user.id)).toEqual(second);
	});

	it('is refused while timed out', async () => {
		const user = await testUser();
		await db.insert(timeouts).values({
			userId: user.id,
			until: new Date(Date.now() + 3600_000),
			reason: 'cool down',
			setBy: user.id
		});
		const put = vi.spyOn(storage, 'putObject');
		await expect(setAvatar(asSession(user), png)).rejects.toBeInstanceOf(TimeoutActiveError);
		expect(put).not.toHaveBeenCalled();
	});
});

describe('removeAvatar', () => {
	it('deletes the objects, clears the row and audits by=self', async () => {
		const user = await testUser();
		const keys = await setAndTrack(asSession(user), png);
		await removeAvatar(asSession(user), user.id);
		expect(await avatarRow(user.id)).toEqual({ avatarKey: null, avatarThumbKey: null });
		expect(await exists(keys.avatarKey)).toBe(false);
		expect(await exists(keys.avatarThumbKey)).toBe(false);
		const rows = await audits('avatar_removed');
		expect(rows).toHaveLength(1);
		expect(rows[0].detail).toBe('by=self');
	});

	it('audits an admin removal with by=admin', async () => {
		const member = await testUser();
		const admin = await testUser({ role: 'admin' });
		const keys = await setAndTrack(asSession(member), png);
		await removeAvatar(asSession(admin), member.id);
		expect(await avatarRow(member.id)).toEqual({ avatarKey: null, avatarThumbKey: null });
		expect(await exists(keys.avatarKey)).toBe(false);
		const rows = await audits('avatar_removed');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: admin.id,
			targetType: 'user',
			targetId: member.id,
			detail: 'by=admin'
		});
	});

	it('refuses other members and moderators', async () => {
		const member = await testUser();
		const other = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const keys = await setAndTrack(asSession(member), png);
		for (const actor of [other, mod]) {
			await expect(removeAvatar(asSession(actor), member.id)).rejects.toThrow(
				new ProfileInputError('Only admins can remove the avatar of other members.')
			);
		}
		expect(await avatarRow(member.id)).toEqual(keys);
	});

	it('is a silent no-op without an avatar', async () => {
		const user = await testUser();
		await removeAvatar(asSession(user), user.id);
		expect(await audits('avatar_removed')).toHaveLength(0);
	});

	it('is allowed while timed out', async () => {
		const user = await testUser();
		const keys = await setAndTrack(asSession(user), png);
		await db.insert(timeouts).values({
			userId: user.id,
			until: new Date(Date.now() + 3600_000),
			reason: 'cool down',
			setBy: user.id
		});
		await removeAvatar(asSession(user), user.id);
		expect(await avatarRow(user.id)).toEqual({ avatarKey: null, avatarThumbKey: null });
		expect(await exists(keys.avatarKey)).toBe(false);
	});

	it('tells the member when an admin removes the avatar', async () => {
		const member = await testUser();
		const admin = await testUser({ role: 'admin' });
		await setAndTrack(asSession(member), png);
		await removeAvatar(asSession(admin), member.id);
		const rows = await noticesOf(member.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'avatar_removed', actorId: null, detail: '' });
		expect(await noticesOf(admin.id)).toHaveLength(0);
	});

	it('writes no notice for a self removal, an admin removing their own, or no avatar', async () => {
		const member = await testUser();
		const admin = await testUser({ role: 'admin' });
		await setAndTrack(asSession(member), png);
		await removeAvatar(asSession(member), member.id);
		await setAndTrack(asSession(admin), png);
		await removeAvatar(asSession(admin), admin.id);
		await removeAvatar(asSession(admin), member.id);
		expect(await db.select().from(notifications)).toHaveLength(0);
	});
});
