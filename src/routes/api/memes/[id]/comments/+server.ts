import { error, json } from '@sveltejs/kit';
import { addComment, CommentTextError, listComments } from '../../../../../lib/server/comments';
import { MediaNotFoundError } from '../../../../../lib/server/votes';
import type { RequestHandler } from './$types';

function parseId(raw: string): number {
	const id = Number(raw);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Not found');
	return id;
}

export const GET: RequestHandler = async ({ params }) => {
	return json({ comments: await listComments(parseId(params.id)) });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const mediaId = parseId(params.id);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const text = (body as { text?: unknown } | null)?.text;
	if (typeof text !== 'string') error(400, 'text must be a string');

	try {
		return json(await addComment(locals.user!.id, mediaId, text), { status: 201 });
	} catch (e) {
		if (e instanceof MediaNotFoundError) error(404, 'Not found');
		if (e instanceof CommentTextError) error(400, e.message);
		throw e;
	}
};
