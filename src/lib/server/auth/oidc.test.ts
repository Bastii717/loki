import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import { createSession } from './session';
import { resetDb, setupDb } from '../db/test-utils';
import { NoAccessError, mapGroupsToRole, upsertUserFromClaims } from './oidc';

beforeAll(setupDb);
beforeEach(resetDb);

describe('mapGroupsToRole', () => {
	it('maps the members group to member', () => {
		expect(mapGroupsToRole(['loki-members'])).toBe('member');
	});
	it('prefers moderator over member', () => {
		expect(mapGroupsToRole(['loki-members', 'loki-mods'])).toBe('moderator');
	});
	it('maps the admins group to admin, even without members group', () => {
		expect(mapGroupsToRole(['loki-admins'])).toBe('admin');
		expect(mapGroupsToRole(['loki-members', 'loki-mods', 'loki-admins'])).toBe('admin');
	});
	it('returns null for unrelated groups or none', () => {
		expect(mapGroupsToRole(['other-app'])).toBeNull();
		expect(mapGroupsToRole([])).toBeNull();
	});
});

describe('upsertUserFromClaims', () => {
	const claims = (extra: Record<string, unknown>) => ({
		sub: 's1',
		preferred_username: 'alice',
		groups: ['loki-members'],
		...extra
	});

	it('creates a user keyed on sub with the mapped role', async () => {
		const user = await upsertUserFromClaims(claims({}));
		expect(user).toEqual({
			id: expect.any(Number),
			username: 'alice',
			displayName: null,
			role: 'member'
		});
	});

	it('updates username and role on the same sub without duplicating', async () => {
		const first = await upsertUserFromClaims(claims({}));
		const second = await upsertUserFromClaims(
			claims({ preferred_username: 'alicia', groups: ['loki-admins'] })
		);
		expect(second).toEqual({ id: first.id, username: 'alicia', displayName: null, role: 'admin' });
		expect(await db.select().from(users).where(eq(users.sub, 's1'))).toHaveLength(1);
	});

	it('keeps the display name across a re-login and returns it', async () => {
		const first = await upsertUserFromClaims(claims({}));
		await db
			.update(users)
			.set({ displayName: 'Lena', displayNameKey: 'lena' })
			.where(eq(users.id, first.id));
		const again = await upsertUserFromClaims(claims({ preferred_username: 'alicia' }));
		expect(again).toEqual({
			id: first.id,
			username: 'alicia',
			displayName: 'Lena',
			role: 'member'
		});
		const [row] = await db.select().from(users).where(eq(users.id, first.id));
		expect(row.displayName).toBe('Lena');
		expect(row.displayNameKey).toBe('lena');
	});

	it('tolerates a missing groups claim by rejecting', async () => {
		await expect(
			upsertUserFromClaims({ sub: 's2', preferred_username: 'bob' })
		).rejects.toBeInstanceOf(NoAccessError);
		expect(await db.select().from(users)).toHaveLength(0);
	});

	it('revokes existing sessions when a returning user no longer has a group', async () => {
		const user = await upsertUserFromClaims(claims({}));
		const other = await upsertUserFromClaims({
			sub: 's9',
			preferred_username: 'carol',
			groups: ['loki-members']
		});
		await createSession(user.id);
		await createSession(user.id);
		await createSession(other.id);

		await expect(
			upsertUserFromClaims({ sub: 's1', preferred_username: 'alice', groups: [] })
		).rejects.toBeInstanceOf(NoAccessError);

		const rows = await db.select().from(sessions);
		expect(rows.map((r) => r.userId)).toEqual([other.id]);
	});

	it('falls back to sub when preferred_username is missing', async () => {
		const user = await upsertUserFromClaims({ sub: 's3', groups: ['loki-members'] });
		expect(user.username).toBe('s3');
	});
});
