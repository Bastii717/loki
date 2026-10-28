import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../../../../lib/server/db';
import { auditLog, users } from '../../../../../../lib/server/db/schema';
import { resetDb, setupDb, testUser } from '../../../../../../lib/server/db/test-utils';
import { setAvatar } from '../../../../../../lib/server/avatar';
import { env } from '../../../../../../lib/server/env';
import { userWithSession } from '../../../../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../../../../lib/server/rate-limit';
import { s3Client } from '../../../../../../lib/server/storage';
import { ensureBucket } from '../../../../../../lib/server/storage-test-utils';
import { callRoute } from '../../../../../../lib/server/test-request';
import { POST } from './+server';

beforeAll(async () => {
	await setupDb();
	await ensureBucket(); // removing an avatar deletes its bucket objects
});
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

const post = (session: string, pid: string, body: unknown) =>
	callRoute({
		handler: POST,
		path: `/api/moderation/users/${pid}/profile`,
		method: 'POST',
		params: { pid },
		session,
		body
	});

const userRow = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];
const exists = (Key: string) =>
	s3Client()
		.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }))
		.then(
			() => true,
			() => false
		);
const audits = () => db.select().from(auditLog).orderBy(auditLog.id);

describe('POST /api/moderation/users/[pid]/profile', () => {
	it('renames a member as admin: row, audit by=admin, response carries the name', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser();
		const { response } = await post(admin.session, member.publicId, {
			action: 'rename',
			displayName: 'Neo Name'
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, displayName: 'Neo Name' });
		const row = await userRow(member.id);
		expect(row.displayName).toBe('Neo Name');
		expect(row.displayNameSetBy).toBe(admin.user.id);
		expect(row.displayNameChangedAt).toBeInstanceOf(Date);
		const rows = await audits();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: admin.user.id,
			action: 'display_name_changed',
			targetType: 'user',
			targetId: member.id
		});
		expect(rows[0].detail).toContain('by=admin');
	});

	it('answers a taken name with 400 and the server message', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser();
		await testUser({ displayName: 'Taken', displayNameKey: 'taken' });
		const { response } = await post(admin.session, member.publicId, {
			action: 'rename',
			displayName: 'Taken'
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toContain('That name is taken.');
		expect((await userRow(member.id)).displayName).toBeNull();
		expect(await audits()).toHaveLength(0);
	});

	it('rejects an invalid name and a missing name with 400', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser();
		const bad = await post(admin.session, member.publicId, {
			action: 'rename',
			displayName: 'b@d'
		});
		expect(bad.response.status).toBe(400);
		expect(await bad.response.text()).toContain('Pick 2 to 24 characters');
		const missing = await post(admin.session, member.publicId, { action: 'rename' });
		expect(missing.response.status).toBe(400);
	});

	it('resets the display name: row cleared, audit written, response name is null', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser({ displayName: 'Old', displayNameKey: 'old' });
		const { response } = await post(admin.session, member.publicId, { action: 'reset' });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, displayName: null });
		expect((await userRow(member.id)).displayName).toBeNull();
		expect((await audits()).map((a) => a.action)).toEqual(['display_name_reset']);
	});

	it('removes an avatar: row cleared, both objects deleted, audited by=admin', async () => {
		const admin = await userWithSession('admin');
		const member = await userWithSession('member');
		const png = await sharp({
			create: { width: 300, height: 500, channels: 3, background: '#f00' }
		})
			.png()
			.toBuffer();
		const keys = await setAvatar(member.user, png);
		expect(await exists(keys.avatarKey)).toBe(true);
		expect(await exists(keys.avatarThumbKey)).toBe(true);
		const { response } = await post(admin.session, member.publicId, { action: 'removeAvatar' });
		expect(response.status).toBe(200);
		const row = await userRow(member.user.id);
		expect(row.avatarKey).toBeNull();
		expect(row.avatarThumbKey).toBeNull();
		expect(await exists(keys.avatarKey)).toBe(false);
		expect(await exists(keys.avatarThumbKey)).toBe(false);
		const removed = (await audits()).filter((a) => a.action === 'avatar_removed');
		expect(removed).toHaveLength(1);
		expect(removed[0]).toMatchObject({
			actorId: admin.user.id,
			targetId: member.user.id,
			detail: 'by=admin'
		});
	});

	it('clears a motto: row emptied and audited by=admin', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser({ motto: 'Hello there' });
		const { response } = await post(admin.session, member.publicId, { action: 'clearMotto' });
		expect(response.status).toBe(200);
		expect((await userRow(member.id)).motto).toBe('');
		const rows = await audits();
		expect(rows.map((a) => a.action)).toEqual(['motto_cleared']);
		expect(rows[0].detail).toBe('by=admin');
	});

	it('rejects unknown actions and unreadable bodies with 400', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser();
		const unknown = await post(admin.session, member.publicId, { action: 'ban' });
		expect(unknown.response.status).toBe(400);
		expect(await unknown.response.text()).toContain('Unknown action.');
		const none = await post(admin.session, member.publicId, undefined);
		expect(none.response.status).toBe(400);
		expect(await audits()).toHaveLength(0);
	});

	it('answers a well-formed unknown public id with 404', async () => {
		const admin = await userWithSession('admin');
		for (const action of ['rename', 'reset', 'removeAvatar', 'clearMotto']) {
			const { response } = await post(admin.session, 'AAAAAAAAAAAA', {
				action,
				displayName: 'Nobody'
			});
			expect(response.status).toBe(404);
			expect(await response.text()).toContain('User not found.');
		}
	});

	it('answers a malformed id, and the internal numeric id, with 404', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser({ motto: 'stays' });
		for (const pid of [
			'abc',
			'1',
			'0',
			'-3',
			'1.5',
			'abcdefghijk',
			'abcdefghijklm',
			String(member.id)
		]) {
			expect((await post(admin.session, pid, { action: 'clearMotto' })).response.status).toBe(404);
		}
		expect((await userRow(member.id)).motto).toBe('stays');
		expect(await audits()).toHaveLength(0);
	});

	it('is admin only: moderators get 403, members are turned away, nothing changes', async () => {
		const mod = await userWithSession('moderator');
		const member = await userWithSession('member');
		const target = await testUser({ motto: 'stays' });
		const forMod = await post(mod.session, target.publicId, { action: 'clearMotto' });
		expect(forMod.response.status).toBe(403);
		expect(await forMod.response.text()).toContain('This area is for admins only.');
		const forMember = await post(member.session, target.publicId, { action: 'clearMotto' });
		expect(forMember.response.status).toBe(403);
		const anonymous = await post('', target.publicId, { action: 'clearMotto' });
		expect(anonymous.response.status).toBe(401);
		expect((await userRow(target.id)).motto).toBe('stays');
		expect(await audits()).toHaveLength(0);
	});
});
