import { canSeeUnderReview } from '../../lib/server/moderation';
import { getDiscoverBatch } from '../../lib/server/discover';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) =>
	getDiscoverBatch(locals.user!.id, undefined, [], canSeeUnderReview(locals.user!));
