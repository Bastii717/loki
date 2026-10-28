import { seasonById } from '../lib/seasons';
import { currentStatus } from '../lib/server/maintenance';
import { activeTimeout, canSeeUnderReview } from '../lib/server/moderation';
import { countOpenCases } from '../lib/server/moderation-queries';
import { countUnread } from '../lib/server/notifications';
import type { LayoutServerLoad } from './$types';

/**
 * `activeTimeout` is the viewer's current timeout ({until, reason}, ISO date) or null: the layout
 * renders it as a banner on every page, so a blocked write (e.g. a silently rolled-back vote)
 * is explained. One cheap indexed query, only for signed-in users.
 *
 * `status` is the app state for the viewer (maintenance, announcement, start-up) with its message
 * and whether the viewer may write; the layout shows the banner and publishes it to the
 * components, which lock their write controls. It refreshes on reload, `invalidateAll()` and `invalidate('loki:status')`, which the layout
 * calls on a timer while a lock is shown so it lifts without a reload.
 *
 * `season` is the active seasonal theme ({id, label, icon}) or null; the layout mirrors its id onto
 * the `<html>` element, and the feed header and login page show its icon. It re-runs with the URL
 * (see the reads in the load), so an admin's `?season=` preview applies on client-side navigation.
 *
 * `unreadNotifications` is the badge on the Alerts tab: the viewer's unread notices (one indexed count,
 * 0 without a query for anonymous requests). It refreshes on reload, `invalidateAll()` and
 * `invalidate('loki:notifications')`, which the layout calls whenever the tab becomes visible.
 *
 * `openCases` is the badge for the Profile tab and the profile link: the number of open report
 * cases, for moderators and admins only (one cheap grouped count; null for everyone else, so
 * members never trigger the query). A timed-out moderator has lost the moderation rights, so
 * they get null too (no badge, no Moderation link). It refreshes on reload and after
 * `invalidateAll()`, which the queue actions call.
 */
export const load: LayoutServerLoad = async ({ locals, url, depends }) => {
	depends('loki:status');
	depends('loki:notifications');
	// The season depends on the URL (an admin's `?season=` preview, resolved by the hook into
	// `locals.season`), so read the URL parts: SvelteKit tracks them and re-runs this load on every
	// navigation and whenever the parameter changes, instead of keeping the previous theme.
	void url.pathname;
	url.searchParams.get('season');
	const timeout = locals.user ? await activeTimeout(locals.user.id) : null;
	const season = locals.season ? seasonById(locals.season.id) : undefined;
	return {
		user: locals.user,
		season: season ? { id: season.id, label: season.label, icon: season.icon } : null,
		status: await currentStatus(locals.user),
		activeTimeout: timeout ? { until: timeout.until.toISOString(), reason: timeout.reason } : null,
		openCases:
			locals.user && !timeout && canSeeUnderReview(locals.user) ? await countOpenCases() : null,
		unreadNotifications: locals.user ? await countUnread(locals.user.id) : 0
	};
};
