import { PAGE_SIZE, PREVIEW, SEARCH_TYPES, type SearchType } from '../../lib/search-view';
import type { FeedItem } from '../../lib/server/feed';
import { canSeeUnderReview } from '../../lib/server/moderation';
import {
	parseQuery,
	searchComments,
	searchMemes,
	searchPeople,
	searchQuotes,
	searchTags,
	type CommentHit,
	type PersonHit,
	type QuoteHit,
	type SearchScope
} from '../../lib/server/search';
import type { PageServerLoad } from './$types';

/** Beyond this page there is nothing left: the searches count at most 500 results. */
const MAX_PAGE = 100;

interface Sections {
	memes?: { items: FeedItem[]; total: number };
	tags?: { name: string; count: number }[];
	people?: { items: PersonHit[]; total: number };
	comments?: { items: CommentHit[]; total: number };
	quotes?: { items: QuoteHit[]; total: number };
}

const parseType = (raw: string | null): SearchType =>
	(SEARCH_TYPES as readonly string[]).includes(raw ?? '') ? (raw as SearchType) : 'all';

/** A positive integer from user input, else 1. */
function parsePage(raw: string | null): number {
	if (raw === null || !/^\d{1,6}$/.test(raw)) return 1;
	return Math.min(Math.max(Number(raw), 1), MAX_PAGE);
}

// The hooks already require a session for this path, so there is no guard of its own.
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;
	const q = url.searchParams.get('q') ?? '';
	const parsed = parseQuery(q);
	const tooShort = q.trim() !== '' && parsed === null;
	const scope: SearchScope | null = parsed?.scope ?? null;
	const text = parsed?.text ?? '';
	// a `#` or `@` prefix wins over ?type=
	const type: SearchType =
		scope === 'tags'
			? 'tags'
			: scope === 'people'
				? 'people'
				: parseType(url.searchParams.get('type'));
	const page = parsePage(url.searchParams.get('page'));
	const sections: Sections = {};
	if (!parsed) return { q, text, scope, type, page, tooShort, sections };

	const revealAll = canSeeUnderReview(user);
	const all = type === 'all';
	const paging = all
		? { limit: PREVIEW, offset: 0 }
		: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
	const wants = (t: SearchType) => all || type === t;

	await Promise.all([
		wants('memes') &&
			searchMemes(user.id, revealAll, text, paging).then((r) => void (sections.memes = r)),
		wants('tags') &&
			searchTags(revealAll, text, paging.limit).then((r) => void (sections.tags = r)),
		wants('people') &&
			searchPeople(revealAll, text, paging).then((r) => void (sections.people = r)),
		wants('comments') &&
			searchComments(revealAll, text, paging).then((r) => void (sections.comments = r)),
		wants('quotes') && searchQuotes(revealAll, text, paging).then((r) => void (sections.quotes = r))
	]);
	return { q, text, scope, type, page, tooShort, sections };
};
