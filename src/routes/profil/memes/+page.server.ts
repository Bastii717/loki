import { canSeeUnderReview } from '../../../lib/server/moderation';
import { getFeedPage } from '../../../lib/server/feed';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	return getFeedPage({
		viewerId: userId,
		revealAll: canSeeUnderReview(locals.user!),
		sort: 'new',
		filter: { uploaderId: userId }
	});
};
