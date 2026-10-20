import { error, json } from '@sveltejs/kit';
import { InvalidCursorError, getFeedPage, parseSort, parseTag } from '../../../lib/server/feed';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	try {
		const page = await getFeedPage({
			viewerId: locals.user.id,
			sort: parseSort(url.searchParams.get('sort')),
			tag: parseTag(url.searchParams.get('tag')),
			cursor: url.searchParams.get('cursor') ?? undefined
		});
		return json(page);
	} catch (e) {
		if (e instanceof InvalidCursorError) error(400, 'Invalid cursor');
		throw e;
	}
};
