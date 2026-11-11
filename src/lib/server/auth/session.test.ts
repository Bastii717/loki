import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { sessions } from '../db/schema';
import { env } from '../env';
import { resetDb, setupDb, testUser } from '../db/test-utils';
import { createSession, destroySession, validateSession } from './session';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const DAY = 24 * 60 * 60 * 1000;

beforeAll(setupDb);
beforeEach(resetDb);

describe('sessions', () => {
	it('creates a session and validates it to a user with role', async () => {
		const user = await testUser({ role: 'moderator' });
		const token = await createSession(user.id);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await validateSession(token)).toEqual({
			id: user.id,
			publicId: user.publicId,
			username: user.username,
			displayName: null,
			role: 'moderator',
			rulesAcceptedAt: null
		});
		const [row] = await db.select().from(sessions);
		expect(row.tokenHash).toBe(hash(token));
		expect(row.tokenHash).not.toBe(token);
	});

	it('returns the display name when the user has set one', async () => {
		const user = await testUser({ displayName: 'Ronja', displayNameKey: 'ronja' });
		const token = await createSession(user.id);
		expect(await validateSession(token)).toMatchObject({ id: user.id, displayName: 'Ronja' });
	});

	it('rejects a tampered token', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
		expect(await validateSession(tampered)).toBeNull();
		expect(await validateSession('')).toBeNull();
	});

	it('returns null for an expired session and deletes the row', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		await db
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(sessions.tokenHash, hash(token)));
		expect(await validateSession(token)).toBeNull();
		expect(await db.select().from(sessions)).toHaveLength(0);
	});

	it('renews the expiry when less than 15 days remain', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		await db
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() + 5 * DAY) })
			.where(eq(sessions.tokenHash, hash(token)));
		expect(await validateSession(token)).not.toBeNull();
		const [row] = await db.select().from(sessions);
		expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
	});

	it('does not renew a fresh session', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		const [before] = await db.select().from(sessions);
		await validateSession(token);
		const [after] = await db.select().from(sessions);
		expect(after.expiresAt).toEqual(before.expiresAt);
	});

	it('destroys a session', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		await destroySession(token);
		expect(await validateSession(token)).toBeNull();
	});

	describe('absolute cap', () => {
		const capMs = () => env.SESSION_ABSOLUTE_MAX_DAYS * DAY;

		it('does not renew past createdAt + cap', async () => {
			const user = await testUser();
			const token = await createSession(user.id);
			const createdAt = new Date(Date.now() - capMs() + 2 * DAY);
			await db
				.update(sessions)
				.set({ createdAt, expiresAt: new Date(Date.now() + DAY) })
				.where(eq(sessions.tokenHash, hash(token)));
			expect(await validateSession(token)).not.toBeNull();
			const [row] = await db.select().from(sessions);
			expect(row.expiresAt.getTime()).toBe(createdAt.getTime() + capMs());
		});

		it('treats a session older than the cap as expired and deletes it', async () => {
			const user = await testUser();
			const token = await createSession(user.id);
			await db
				.update(sessions)
				.set({
					createdAt: new Date(Date.now() - capMs() - DAY),
					expiresAt: new Date(Date.now() + 20 * DAY)
				})
				.where(eq(sessions.tokenHash, hash(token)));
			expect(await validateSession(token)).toBeNull();
			expect(await db.select().from(sessions)).toHaveLength(0);
		});
	});
});
