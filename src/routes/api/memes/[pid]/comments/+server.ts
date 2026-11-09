import { canSeeUnderReview } from '../../../../../lib/server/moderation';
import { error, json } from '@sveltejs/kit';
import {
	addComment,
	CommentNotFoundError,
	CommentTextError,
	listComments,
	TooManyMentionsError
} from '../../../../../lib/server/comments';
import { mapModerationError } from '../../../../../lib/server/moderation-http';
import { resolveCommentId, resolveMediaId } from '../../../../../lib/server/public-ids';
import { MediaNotFoundError } from '../../../../../lib/server/votes';
import type { RequestHandler } from './$types';

/** The meme's internal id for a public id from the URL; an invalid or unknown id is a 404. */
async function parseId(pid: string): Promise<number> {
	const id = await resolveMediaId(pid);
	if (id === null) error(404, 'Not found');
	return id;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const revealAll = canSeeUnderReview(locals.user!);
	return json({
		comments: await listComments(await parseId(params.pid), locals.user!.id, revealAll)
	});
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const mediaId = await parseId(params.pid);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const { text, replyTo } = (body ?? {}) as { text?: unknown; replyTo?: unknown };
	if (typeof text !== 'string') error(400, 'text must be a string');
	let replyToId: number | null = null;
	if (replyTo !== undefined && replyTo !== null) {
		if (typeof replyTo !== 'string') error(400, 'replyTo must be a string');
		replyToId = await resolveCommentId(replyTo);
		if (replyToId === null) error(404, 'Not found');
	}

	try {
		return json(await addComment(locals.user!.id, mediaId, text, replyToId), { status: 201 });
	} catch (e) {
		if (e instanceof MediaNotFoundError) error(404, 'Not found');
		if (e instanceof CommentNotFoundError) error(404, 'Not found');
		if (e instanceof CommentTextError || e instanceof TooManyMentionsError) error(400, e.message);
		mapModerationError(e);
	}
};
