import { error } from '@sveltejs/kit';
import type { SessionUser } from './auth/session';
import { assertNotTimedOut, TimeoutActiveError } from './moderation';
import { timeoutMessage } from './moderation-http';

export type ModerationLevel = 'moderator' | 'admin';

const RANK: Record<SessionUser['role'], number> = { member: 0, moderator: 1, admin: 2 };

/**
 * The single gate for /moderation pages and moderation APIs. moderation.ts trusts the actor's role,
 * so every load and handler calls this BEFORE touching a module. In order:
 * 1. no session -> 401, role below `level` -> 403 (members learn nothing, not even a timeout state),
 * 2. a timed-out moderator/admin loses moderation rights while the timeout lasts -> 403 with the
 *    English timeout notice.
 * Returns the verified user.
 */
export async function requireModerator<U extends SessionUser>(
	user: U | null | undefined,
	level: ModerationLevel = 'moderator'
): Promise<U> {
	if (!user) error(401, 'Not signed in.');
	if (RANK[user.role] < RANK[level]) {
		error(
			403,
			level === 'admin'
				? 'This area is for admins only.'
				: 'This area is for moderators and admins only.'
		);
	}
	try {
		await assertNotTimedOut(user);
	} catch (e) {
		if (e instanceof TimeoutActiveError) {
			error(403, `${timeoutMessage(e)}. Your moderation rights are paused until then.`);
		}
		throw e;
	}
	return user;
}
