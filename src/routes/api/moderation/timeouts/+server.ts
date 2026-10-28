import { error } from '@sveltejs/kit';
import {
	MAX_TIMEOUT_DAYS,
	MAX_TIMEOUT_REASON,
	setTimeout_
} from '../../../../lib/server/moderation';
import { requireModerator } from '../../../../lib/server/moderation-guard';
import { mapTimeoutActionError } from '../../../../lib/server/moderation-http';
import { isPublicId, resolveUserId } from '../../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

/** Sets (or replaces) a timeout on a user: moderators and admins, within the role matrix of setTimeout_. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const actor = await requireModerator(locals.user);

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, 'Invalid request.');
	}
	const { userId, days, reason } = (raw ?? {}) as Record<string, unknown>;
	if (!isPublicId(userId)) error(400, 'Please select a user.');
	if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_TIMEOUT_DAYS) {
		error(400, `Please give 1 to ${MAX_TIMEOUT_DAYS} days.`);
	}
	if (typeof reason !== 'string' || reason.trim() === '' || reason.length > MAX_TIMEOUT_REASON) {
		error(400, `Please give a reason (${MAX_TIMEOUT_REASON} characters max).`);
	}

	const targetId = await resolveUserId(userId);
	if (targetId === null) error(404, 'User not found.');

	try {
		await setTimeout_(actor, targetId, days, reason);
	} catch (e) {
		mapTimeoutActionError(e);
	}
	return new Response(null, { status: 204 });
};
