import { canSeeUnderReview } from '../../../lib/server/moderation';
import { error, json } from '@sveltejs/kit';
import { getDiscoverBatch } from '../../../lib/server/discover';
import { isPublicId } from '../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const exclude = (url.searchParams.get('exclude') ?? '').split(',').filter(isPublicId).slice(-500); // most recent ids; the client sends oldest first
	return json(
		await getDiscoverBatch(locals.user.id, undefined, exclude, canSeeUnderReview(locals.user))
	);
};
