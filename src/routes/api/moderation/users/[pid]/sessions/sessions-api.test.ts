import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../../../../../../lib/server/auth/session';
import { db } from '../../../../../../lib/server/db';
import { auditLog, sessions } from '../../../../../../lib/server/db/schema';
import { resetDb, setupDb, testUser } from '../../../../../../lib/server/db/test-utils';
import { userWithSession } from '../../../../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../../../../lib/server/rate-limit';
import { callRoute } from '../../../../../../lib/server/test-request';
import { DELETE } from './+server';

beforeAll(async () => {
	await setupDb();
});
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

const del = (session: string | undefined, pid: string) =>
	callRoute({
		handler: DELETE,
		path: `/api/moderation/users/${pid}/sessions`,
		method: 'DELETE',
		params: { pid },
		session
	});

const sessionsOf = (userId: number) =>
	db.select().from(sessions).where(eq(sessions.userId, userId));

describe('DELETE /api/moderation/users/[pid]/sessions', () => {
	it('ends all sessions of a user as admin and audits it with the username', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser();
		await createSession(member.id);
		await createSession(member.id);
		expect(await sessionsOf(member.id)).toHaveLength(2);

		const { response } = await del(admin.session, member.publicId);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(await sessionsOf(member.id)).toHaveLength(0);
		expect(await sessionsOf(admin.user.id)).toHaveLength(1);
		const rows = await db.select().from(auditLog);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: admin.user.id,
			action: 'sessions_ended',
			targetType: 'user',
			targetId: member.id,
			detail: member.username
		});
	});

	it('answers 200 and audits even when the user has no sessions', async () => {
		const admin = await userWithSession('admin');
		const member = await testUser();
		const { response } = await del(admin.session, member.publicId);
		expect(response.status).toBe(200);
		expect(await db.select().from(auditLog)).toHaveLength(1);
	});

	it('rejects a moderator who is not an admin with 403 and keeps the sessions', async () => {
		const mod = await userWithSession('moderator');
		const member = await testUser();
		await createSession(member.id);
		const { response } = await del(mod.session, member.publicId);
		expect(response.status).toBe(403);
		expect(await sessionsOf(member.id)).toHaveLength(1);
		expect(await db.select().from(auditLog)).toHaveLength(0);
	});

	it('answers 404 for an unknown public id', async () => {
		const admin = await userWithSession('admin');
		const { response } = await del(admin.session, 'Zz9Zz9Zz9Zz9');
		expect(response.status).toBe(404);
	});

	it('answers 401 without a session', async () => {
		const member = await testUser();
		const { response } = await del(undefined, member.publicId);
		expect(response.status).toBe(401);
	});
});
