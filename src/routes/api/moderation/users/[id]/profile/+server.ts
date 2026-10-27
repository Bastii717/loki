import { error, json } from '@sveltejs/kit';
import { removeAvatar } from '../../../../../../lib/server/avatar';
import { requireModerator } from '../../../../../../lib/server/moderation-guard';
import {
	clearMotto,
	getProfile,
	ProfileInputError,
	resetDisplayName,
	setDisplayName
} from '../../../../../../lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * Admin profile tools: rename, reset the name, remove the avatar or clear the motto of any member.
 * Every action goes through the profile/avatar modules, which enforce the admin rule and audit it.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const actor = await requireModerator(locals.user, 'admin');
	const userId = Number(params.id);
	if (!Number.isSafeInteger(userId) || userId <= 0) error(404, 'User not found.');

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, 'Invalid request.');
	}
	const { action, displayName } = (raw ?? {}) as Record<string, unknown>;

	try {
		switch (action) {
			case 'rename':
				if (typeof displayName !== 'string') error(400, 'Please enter a name.');
				await setDisplayName(actor, userId, displayName);
				break;
			case 'reset':
				await resetDisplayName(actor, userId);
				break;
			case 'removeAvatar':
				await removeAvatar(actor, userId);
				break;
			case 'clearMotto':
				await clearMotto(actor, userId);
				break;
			default:
				error(400, 'Unknown action.');
		}
		return json({ ok: true, displayName: (await getProfile(userId)).displayName });
	} catch (e) {
		if (e instanceof ProfileInputError) error(400, e.message);
		throw e;
	}
};
