import {
	berlinMonth,
	leadingNow,
	listAwards,
	monthStart,
	nextMonth
} from '../../lib/server/awards';
import { getFeedPage, type FeedItem } from '../../lib/server/feed';
import { canSeeUnderReview } from '../../lib/server/moderation';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 12;
// years 1000-9999: Postgres rejects year 0000
const MONTH = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;

/** A `YYYY-MM` from the query, else undefined. */
const parseMonth = (raw: string | null) => (raw !== null && MONTH.test(raw) ? raw : undefined);

// The hooks already require a session for this path, so there is no guard of its own.
export const load: PageServerLoad = async ({ locals, url }) => {
	const now = new Date();
	const user = locals.user!;
	const revealAll = canSeeUnderReview(user);
	const before = parseMonth(url.searchParams.get('before'));
	const from = parseMonth(url.searchParams.get('from'));

	// the leader belongs to the first page only; a paged or anchored view skips the query too
	const firstPage = before === undefined && from === undefined;
	const [{ rows, hasMore }, lead] = await Promise.all([
		listAwards({ before, from, limit: PAGE_SIZE }),
		firstPage ? leadingNow(now) : null
	]);

	// one hydration for the page and the leader; a meme deleted meanwhile is simply not returned
	const ids = [...rows.map((r) => r.mediaPublicId), lead?.mediaPublicId].filter((id) => id != null);
	const byId = new Map<string, FeedItem>();
	if (ids.length > 0) {
		const page = await getFeedPage({
			viewerId: user.id,
			revealAll,
			sort: 'new',
			ids,
			limit: ids.length
		});
		for (const item of page.items) byId.set(item.id, item);
	}

	// no stored title goes to the page: a deleted winner shows a fixed note, a hidden one a placeholder
	const sections = rows.map((row) => ({
		month: row.month,
		item: (row.mediaPublicId !== null && byId.get(row.mediaPublicId)) || null
	}));
	const leadItem = lead ? (byId.get(lead.mediaPublicId) ?? null) : null;
	// a member never gets a placeholder for the leader: no card is better than a hidden one
	const leading =
		lead && leadItem && (revealAll || !leadItem.underReview)
			? { month: lead.month, item: leadItem, score: lead.score }
			: null;

	return {
		leading,
		sections,
		hasMore,
		nextBefore: hasMore ? (sections.at(-1)?.month ?? null) : null,
		firstClose: monthStart(nextMonth(berlinMonth(now))).toISOString()
	};
};
