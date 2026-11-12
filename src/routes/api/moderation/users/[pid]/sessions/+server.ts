import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../../lib/server/db';
import { sessions, users } from '../../../../../../lib/server/db/schema';
import { AUDIT_ACTIONS, audit } from '../../../../../../lib/server/moderation';
import { requireModerator } from '../../../../../../lib/server/moderation-guard';
import { isPublicId, resolveUserId } from '../../../../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

/**
 * Admin tool: ends every Loki session of a member. Roles are only copied from Authentik at login,
 * so this makes them sign in again and come back with their current groups.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const actor = await requireModerator(locals.user, 'admin');
	if (!isPublicId(params.pid)) error(404, 'User not found.');
	const userId = await resolveUserId(params.pid);
	if (userId === null) error(404, 'User not found.');

	await db.transaction(async (tx) => {
		const [target] = await tx
			.select({ username: users.username })
			.from(users)
			.where(eq(users.id, userId));
		if (!target) error(404, 'User not found.');
		await tx.delete(sessions).where(eq(sessions.userId, userId));
		await audit(actor.id, AUDIT_ACTIONS.sessionsEnded, 'user', userId, target.username, tx);
	});
	return json({ ok: true });
};
