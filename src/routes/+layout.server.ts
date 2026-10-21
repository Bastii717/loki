import { canSeeUnderReview } from '../lib/server/moderation';
import { countOpenCases } from '../lib/server/moderation-queries';
import type { LayoutServerLoad } from './$types';

/**
 * `openCases` is the badge for the Profil tab and the profile link: the number of open report
 * cases, for moderators and admins only (one cheap grouped count; null for everyone else, so
 * members never trigger the query). It refreshes on reload and after `invalidateAll()`, which
 * the queue actions call.
 */
export const load: LayoutServerLoad = async ({ locals }) => ({
	user: locals.user,
	openCases: locals.user && canSeeUnderReview(locals.user) ? await countOpenCases() : null
});
