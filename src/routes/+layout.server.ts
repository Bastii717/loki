import { currentStatus } from '../lib/server/maintenance';
import { activeTimeout, canSeeUnderReview } from '../lib/server/moderation';
import { countOpenCases } from '../lib/server/moderation-queries';
import type { LayoutServerLoad } from './$types';

/**
 * `activeTimeout` is the viewer's current timeout ({until, reason}, ISO date) or null: the layout
 * renders it as a banner on every page, so a blocked write (e.g. a silently rolled-back vote)
 * is explained. One cheap indexed query, only for signed-in users.
 *
 * `status` is the app state for the viewer (maintenance, announcement, start-up) with its message
 * and whether the viewer may write; the layout shows the banner and publishes it to the
 * components, which lock their write controls. It refreshes on reload and `invalidateAll()`.
 *
 * `openCases` is the badge for the Profile tab and the profile link: the number of open report
 * cases, for moderators and admins only (one cheap grouped count; null for everyone else, so
 * members never trigger the query). A timed-out moderator has lost the moderation rights, so
 * they get null too (no badge, no Moderation link). It refreshes on reload and after
 * `invalidateAll()`, which the queue actions call.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const timeout = locals.user ? await activeTimeout(locals.user.id) : null;
	return {
		user: locals.user,
		status: await currentStatus(locals.user),
		activeTimeout: timeout ? { until: timeout.until.toISOString(), reason: timeout.reason } : null,
		openCases:
			locals.user && !timeout && canSeeUnderReview(locals.user) ? await countOpenCases() : null
	};
};
