import { error } from '@sveltejs/kit';
import {
	CommentNotFoundError,
	CommentPermissionError,
	deleteComment
} from '../../../../lib/server/comments';
import { mapModerationError } from '../../../../lib/server/moderation-http';
import { resolveCommentId } from '../../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

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
