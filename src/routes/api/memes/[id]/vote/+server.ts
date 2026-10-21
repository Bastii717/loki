import { error, json } from '@sveltejs/kit';
import { applyVote, MediaNotFoundError, type VoteValue } from '../../../../../lib/server/votes';
import { mapModerationError } from '../../../../../lib/server/moderation-http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const mediaId = Number(params.id);
	if (!Number.isSafeInteger(mediaId) || mediaId <= 0) error(404, 'Not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const value = (body as { value?: unknown } | null)?.value;
	if (value !== 1 && value !== -1 && value !== 0) error(400, 'value must be 1, -1 or 0');

	try {
		return json(await applyVote(locals.user!.id, mediaId, value as VoteValue));
	} catch (e) {
		if (e instanceof MediaNotFoundError) error(404, 'Not found');
		mapModerationError(e);
	}
};
