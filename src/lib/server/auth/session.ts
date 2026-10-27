import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { env } from '../env';
import { sessions, users } from '../db/schema';

export type SessionUser = {
	id: number;
	username: string;
	/** Self-chosen name shown instead of the username; null until the member picks one. */
	displayName: string | null;
	role: 'member' | 'moderator' | 'admin';
};

export const SESSION_COOKIE = 'loki_session';
export const SESSION_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	secure: true,
	sameSite: 'lax',
	maxAge: 30 * 24 * 60 * 60 // seconds, matches the session row TTL
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
	return (await resolveSession(token))?.user ?? null;
}

/** Like validateSession, but also reports whether the expiry was extended (cookie must be re-set). */
export async function resolveSession(
	token: string
): Promise<{ user: SessionUser; renewed: boolean } | null> {
	if (!token) return null;
	const tokenHash = hashToken(token);
	const [row] = await db
		.select({
			expiresAt: sessions.expiresAt,
			createdAt: sessions.createdAt,
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			role: users.role
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.tokenHash, tokenHash));
	if (!row) return null;

	// Absolute cap: sliding renewal can never keep a session (and stale roles) alive past it.
	const hardExpiry = row.createdAt.getTime() + env.SESSION_ABSOLUTE_MAX_DAYS * DAY_MS;
	const remaining = Math.min(row.expiresAt.getTime(), hardExpiry) - Date.now();
	if (remaining <= 0) {
		await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
		return null;
	}
	const renewedExpiry = Math.min(Date.now() + SESSION_TTL_MS, hardExpiry);
	const renewed = remaining < RENEW_BELOW_MS && renewedExpiry > row.expiresAt.getTime();
	if (renewed) {
		await db
			.update(sessions)
			.set({ expiresAt: new Date(renewedExpiry) })
			.where(eq(sessions.tokenHash, tokenHash));
	}
	return {
		user: {
			id: row.id,
			username: row.username,
			displayName: row.displayName,
			role: row.role as SessionUser['role']
		},
		renewed
	};
}

export async function destroySession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
