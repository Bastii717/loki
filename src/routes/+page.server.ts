import { getFeedPage, parseSort, parseTag } from '../lib/server/feed';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const sort = parseSort(url.searchParams.get('sort'));
	const tag = parseTag(url.searchParams.get('tag'));
	const { items, nextCursor } = await getFeedPage({ viewerId: locals.user!.id, sort, tag });
	return { sort, tag: tag ?? null, items, nextCursor };
};
