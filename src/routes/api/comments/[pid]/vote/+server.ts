import { error, json } from '@sveltejs/kit';
import {
	CommentNotFoundError,
	CommentVoteOwnError,
	voteComment
} from '../../../../../lib/server/comments';
import { canSeeUnderReview } from '../../../../../lib/server/moderation';
import { mapModerationError } from '../../../../../lib/server/moderation-http';
import { isPublicId, resolveCommentId } from '../../../../../lib/server/public-ids';
import type { VoteValue } from '../../../../../lib/server/votes';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!isPublicId(params.pid)) error(404, 'Not found');
	const id = await resolveCommentId(params.pid);
	if (id === null) error(404, 'Not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const value = (body as { value?: unknown } | null)?.value;
	if (value !== 1 && value !== -1 && value !== 0) error(400, 'value must be 1, -1 or 0');

	try {
		const user = locals.user!;
		return json(await voteComment(user.id, id, value as VoteValue, canSeeUnderReview(user)));
	} catch (e) {
		if (e instanceof CommentNotFoundError) error(404, 'Not found');
		if (e instanceof CommentVoteOwnError) error(403, 'Own comments cannot be voted on');
		mapModerationError(e);
	}
};
