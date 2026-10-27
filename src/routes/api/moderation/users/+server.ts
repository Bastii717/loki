import { json } from '@sveltejs/kit';
import { requireModerator } from '../../../../lib/server/moderation-guard';
import { searchUsers } from '../../../../lib/server/moderation-queries';
import type { RequestHandler } from './$types';

/**
 * Username search for the timeout picker. Moderators may set timeouts, so they may list users;
 * each hit says whether the caller may time that user out (moderators: members only, nobody: self).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const actor = await requireModerator(locals.user);
	const found = await searchUsers(url.searchParams.get('q') ?? '');
	return json({
		users: found.map((u) => ({
			id: u.id,
			username: u.username,
			displayName: u.displayName,
			role: u.role,
			timeoutable: u.id !== actor.id && (actor.role === 'admin' || u.role === 'member')
		}))
	});
};
