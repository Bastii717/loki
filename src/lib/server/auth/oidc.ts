import * as client from 'openid-client';
import { db } from '../db';
import { users } from '../db/schema';
import { env } from '../env';
import type { SessionUser } from './session';

import { NO_ACCESS_MESSAGE } from '../../auth-messages';

/** Thrown when the identity provider authenticated the user but no Loki group applies. */
export class NoAccessError extends Error {
	constructor() {
		super(NO_ACCESS_MESSAGE);
	}
}

/** Highest matching group wins: admin > moderator > member; null means no access. */
export function mapGroupsToRole(groups: string[]): SessionUser['role'] | null {
	if (groups.includes(env.OIDC_GROUP_ADMINS)) return 'admin';
	if (groups.includes(env.OIDC_GROUP_MODS)) return 'moderator';
	if (groups.includes(env.OIDC_GROUP_MEMBERS)) return 'member';
	return null;
}

/** Creates or updates the user keyed on `sub`; throws NoAccessError if the groups grant no role. */
export async function upsertUserFromClaims(claims: Record<string, unknown>): Promise<SessionUser> {
	const raw = claims[env.OIDC_GROUPS_CLAIM];
	const groups = Array.isArray(raw) ? raw.filter((g): g is string => typeof g === 'string') : [];
	const role = mapGroupsToRole(groups);
	if (!role) throw new NoAccessError();

	const sub = String(claims.sub);
	const username =
		typeof claims.preferred_username === 'string' && claims.preferred_username
			? claims.preferred_username
			: sub;
	const [row] = await db
		.insert(users)
		.values({ sub, username, role })
		.onConflictDoUpdate({ target: users.sub, set: { username, role } })
		.returning();
	return { id: row.id, username: row.username, role };
}

let configuration: Promise<client.Configuration> | undefined;

/** Discovery runs on first login attempt and is cached; a failure is not cached. */
export function getConfiguration(): Promise<client.Configuration> {
	configuration ??= client
		.discovery(
			new URL(env.OIDC_ISSUER),
			env.OIDC_CLIENT_ID,
			env.OIDC_CLIENT_SECRET,
			undefined,
			// the dev IdP is plain http; production issuers are https and unaffected
			new URL(env.OIDC_ISSUER).protocol === 'http:'
				? { execute: [client.allowInsecureRequests] }
				: undefined
		)
		.catch((err) => {
			configuration = undefined;
			throw err;
		});
	return configuration;
}

export { client };

export const redirectUri = (requestUrl: URL) =>
	`${process.env.ORIGIN ?? requestUrl.origin}/auth/callback`;

export const STATE_COOKIE = 'loki_oidc_state';
export const VERIFIER_COOKIE = 'loki_oidc_verifier';
/** Short-lived (10 min) cookies; only sent to the callback path. */
export const FLOW_COOKIE_OPTIONS = {
	path: '/auth/callback',
	httpOnly: true,
	secure: true,
	sameSite: 'lax',
	maxAge: 600
} as const;
