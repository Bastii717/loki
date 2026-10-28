/** What the search page shares between its load function and its template (no server imports). */

export const SEARCH_TYPES = ['all', 'memes', 'tags', 'people', 'comments', 'quotes'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Results per section in the All view. */
export const PREVIEW = 5;
/** Results per page in a typed view. */
export const PAGE_SIZE = 30;
/** `total` never exceeds this (the searches stop counting here); a total at the cap reads "500+". */
export const TOTAL_CAP = 500;

/**
 * Splits `excerpt` around the first case-insensitive occurrence of `needle`, so the template can
 * wrap `match` in `<mark>` and still print every part as escaped text. Null when it does not occur.
 */
export function highlight(
	excerpt: string,
	needle: string
): { before: string; match: string; after: string } | null {
	if (needle === '') return null;
	const hit = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(excerpt);
	if (!hit) return null;
	return {
		before: excerpt.slice(0, hit.index),
		match: hit[0],
		after: excerpt.slice(hit.index + hit[0].length)
	};
}
