import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users } from '../db/schema';

export type SessionUser = {
	id: number;
	username: string;
	role: 'member' | 'moderator' | 'admin';
};

export const SESSION_COOKIE = 'loki_session';
export const SESSION_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	secure: true,
	sameSite: 'lax'
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;
const RENEW_BELOW_MS = 15 * DAY_MS;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Creates a session for the user and returns the raw token (the cookie value). */
export async function createSession(userId: number): Promise<string> {
	const token = randomBytes(32).toString('base64url');
	await db.insert(sessions).values({
		tokenHash: hashToken(token),
		userId,
		expiresAt: new Date(Date.now() + SESSION_TTL_MS)
	});
	return token;
}

/** Returns the session's user, or null if unknown/expired. Renews sessions nearing expiry. */
export async function validateSession(token: string): Promise<SessionUser | null> {
	if (!token) return null;
	const tokenHash = hashToken(token);
	const [row] = await db
		.select({
			expiresAt: sessions.expiresAt,
			id: users.id,
			username: users.username,
			role: users.role
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.tokenHash, tokenHash));
	if (!row) return null;

	const remaining = row.expiresAt.getTime() - Date.now();
	if (remaining <= 0) {
		await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
		return null;
	}
	if (remaining < RENEW_BELOW_MS) {
		await db
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
			.where(eq(sessions.tokenHash, tokenHash));
	}
	return { id: row.id, username: row.username, role: row.role as SessionUser['role'] };
}

export async function destroySession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
