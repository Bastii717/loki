import { error, json } from '@sveltejs/kit';
import {
	CommentEditWindowError,
	CommentNotFoundError,
	CommentPermissionError,
	CommentTextError,
	deleteComment,
	editComment,
	TooManyMentionsError
} from '../../../../lib/server/comments';
import { mapModerationError } from '../../../../lib/server/moderation-http';
import { resolveCommentId } from '../../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

/** Edits the own comment within the edit window; answers with the updated comment. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = await resolveCommentId(params.pid);
	if (id === null) error(404, 'Not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const text = (body as { text?: unknown } | null)?.text;
	if (typeof text !== 'string') error(400, 'text must be a string');

	try {
		return json(await editComment(locals.user!.id, id, text));
	} catch (e) {
		if (e instanceof CommentNotFoundError) error(404, 'Not found');
		if (e instanceof CommentPermissionError) error(403, 'Forbidden');
		if (e instanceof CommentEditWindowError) error(403, e.message);
		if (e instanceof CommentTextError || e instanceof TooManyMentionsError) error(400, e.message);
		mapModerationError(e);
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const id = await resolveCommentId(params.pid);
	if (id === null) error(404, 'Not found');
	try {
		await deleteComment(locals.user!, id);
	} catch (e) {
		if (e instanceof CommentNotFoundError) error(404, 'Not found');
		if (e instanceof CommentPermissionError) error(403, 'Forbidden');
		mapModerationError(e);
	}
	return new Response(null, { status: 204 });
};
