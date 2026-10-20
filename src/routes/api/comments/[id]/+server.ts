import { error } from '@sveltejs/kit';
import {
	CommentNotFoundError,
	CommentPermissionError,
	deleteComment
} from '../../../../lib/server/comments';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Not found');
	try {
		await deleteComment(locals.user!, id);
	} catch (e) {
		if (e instanceof CommentNotFoundError) error(404, 'Not found');
		if (e instanceof CommentPermissionError) error(403, 'Forbidden');
		throw e;
	}
	return new Response(null, { status: 204 });
};
