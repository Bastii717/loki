import { error } from '@sveltejs/kit';
import { liftTimeout } from '../../../../../lib/server/moderation';
import { requireModerator } from '../../../../../lib/server/moderation-guard';
import { mapTimeoutActionError } from '../../../../../lib/server/moderation-http';
import type { RequestHandler } from './$types';

/** Lifts the active timeout of a user early. Same actor rules as setting one. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const actor = await requireModerator(locals.user);
	const userId = Number(params.userId);
	if (!Number.isSafeInteger(userId) || userId <= 0) error(404, 'User not found.');
	try {
		await liftTimeout(actor, userId);
	} catch (e) {
		mapTimeoutActionError(e);
	}
	return new Response(null, { status: 204 });
};
