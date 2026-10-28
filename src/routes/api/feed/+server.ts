import { canSeeUnderReview } from '../../../lib/server/moderation';
import { error, json } from '@sveltejs/kit';
import { InvalidCursorError, getFeedPage, parseSort, parseTag } from '../../../lib/server/feed';
import { isPublicId, resolveUserId } from '../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const revealAll = canSeeUnderReview(locals.user);
	// ?uploader=<public id>: a member's memes (member pages); hidden ones are dropped for members
	const uploaderParam = url.searchParams.get('uploader');
	let uploaderId: number | undefined;
	if (uploaderParam !== null) {
		if (!isPublicId(uploaderParam)) error(400, 'Invalid uploader');
		const resolved = await resolveUserId(uploaderParam);
		if (resolved === null) error(404, 'Not found');
		uploaderId = resolved;
	}
	try {
		const page = await getFeedPage({
			viewerId: locals.user.id,
			revealAll,
			sort: parseSort(url.searchParams.get('sort')),
			tag: parseTag(url.searchParams.get('tag')),
			cursor: url.searchParams.get('cursor') ?? undefined,
			// profile lists page through the same endpoint: ?list=mine | favorites (always the viewer's own)
			filter:
				uploaderId !== undefined
					? { uploaderId, hideUnderReview: !revealAll }
					: url.searchParams.get('list') === 'mine'
						? { uploaderId: locals.user.id }
						: url.searchParams.get('list') === 'favorites'
							? { favoriteOf: locals.user.id }
							: undefined
		});
		return json(page);
	} catch (e) {
		if (e instanceof InvalidCursorError) error(400, 'Invalid cursor');
		throw e;
	}
};
