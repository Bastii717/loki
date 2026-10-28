import { sql, type SQL } from 'drizzle-orm';
import { TOTAL_CAP } from '../search-view';
import { db } from './db';
import { getFeedPage, type FeedItem } from './feed';
import { underReviewSql } from './moderation';

export type SearchScope = 'all' | 'tags' | 'people';

export const QUERY_MAX = 80;
export const QUERY_MIN = 2;
/** pg_trgm's default `similarity_threshold`, which the `%` operator used below applies. */
export const SIMILARITY_MIN = 0.3;
/**
 * Word-similarity threshold for the `<%` operator, below pg_trgm's default of 0.6: a one-letter
 * typo in a word inside a longer text ("metting" for "meeting") scores about 0.45.
 */
export const WORD_SIMILARITY_MIN = 0.4;
export { TOTAL_CAP };

/** getFeedPage hydrates at most this many items per call. */
const FEED_MAX = 50;

export interface Page {
	limit: number;
	offset: number;
}

/**
 * The `q` parameter as a search: whitespace collapsed, cut at QUERY_MAX, a leading `#` (tags) or
 * `@` (people) turned into the scope. Null when there is nothing to search for (missing, or fewer
 * than QUERY_MIN characters left).
 */
export function parseQuery(raw: string | null): { scope: SearchScope; text: string } | null {
	if (raw === null) return null;
	// Control characters go (a NUL byte makes PostgreSQL reject the query); tab, newline and the
	// like are whitespace and collapse into a space below.
	let text = raw
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '')
		.trim()
		.replace(/\s+/g, ' ')
		.slice(0, QUERY_MAX);
	let scope: SearchScope = 'all';
	if (text.startsWith('#')) {
		scope = 'tags';
		text = text.slice(1).trim();
	} else if (text.startsWith('@')) {
		scope = 'people';
		text = text.slice(1).trim();
	}
	return text.length >= QUERY_MIN ? { scope, text } : null;
}

/** Escapes `%`, `_` and `\` so the text is matched literally inside a LIKE pattern. */
export function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * About `width` characters of `text` centred on the first case-insensitive occurrence of `needle`
 * (the first `width` characters when it does not occur), whitespace collapsed, `…` where cut.
 */
export function excerptAround(text: string, needle: string, width = 160): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat.length <= width) return flat;
	const at = flat.toLowerCase().indexOf(needle.toLowerCase());
	if (at === -1) return `${flat.slice(0, width).trimEnd()}…`;
	const start = Math.min(
		Math.max(Math.round(at + needle.length / 2 - width / 2), 0),
		flat.length - width
	);
	const end = start + width;
	return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

// --- matching --------------------------------------------------------------------------------

/** Long text (titles, comments, quotes): substring, or a typo inside it (word similarity, `<%`). */
const matchLong = (text: string, col: SQL): SQL =>
	sql`(${col} ILIKE ${`%${escapeLike(text)}%`} ESCAPE '\\' OR ${text} <% ${col})`;

/** Short text (tag and person names): substring, or a near miss (similarity, `%`). */
const matchShort = (text: string, col: SQL): SQL =>
	sql`(${col} ILIKE ${`%${escapeLike(text)}%`} ESCAPE '\\' OR ${text} % ${col})`;

type Executor = Pick<typeof db, 'execute'>;

/**
 * Runs `fn` on a transaction that pins both trigram thresholds, so a database or role default
 * cannot change what matches: `<%` uses WORD_SIMILARITY_MIN, `%` uses SIMILARITY_MIN (the settings
 * are local to the transaction).
 */
const withThresholds = <T>(fn: (q: Executor) => Promise<T>): Promise<T> =>
	db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(WORD_SIMILARITY_MIN)}, true),
				set_config('pg_trgm.similarity_threshold', ${String(SIMILARITY_MIN)}, true)`
		);
		return fn(tx);
	});

/** Rows of `from ... where`, counted over a subquery that stops at TOTAL_CAP rows. */
async function cappedCount(q: Executor, from: SQL, where: SQL): Promise<number> {
	const [row] = await q.execute<{ n: number }>(
		sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${from} WHERE ${where} LIMIT ${TOTAL_CAP}) capped`
	);
	return row.n;
}

const limitOffset = (page: Page, max = Infinity): SQL =>
	sql`LIMIT ${Math.min(Math.max(Math.trunc(page.limit), 1), max)} OFFSET ${Math.max(Math.trunc(page.offset), 0)}`;

const toIso = (value: Date | string): string => new Date(value).toISOString();

type Role = 'member' | 'moderator' | 'admin';

// --- memes -----------------------------------------------------------------------------------

/** Memes whose title or any tag matches, ranked by title similarity then newest; hydrated like the feed. */
export async function searchMemes(
	viewerId: number,
	revealAll: boolean,
	text: string,
	page: Page
): Promise<{ items: FeedItem[]; total: number }> {
	const from = sql`media m`;
	const where = sql`(${matchLong(text, sql`m.title`)} OR EXISTS (
			SELECT 1 FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
			WHERE mt.media_id = m.id AND ${matchShort(text, sql`t.name`)}
		)) ${revealAll ? sql`` : sql`AND NOT ${underReviewSql('meme', sql`m.id`, sql`m.reviewed_at`)}`}`;

	const { rows, total } = await withThresholds(async (q) => {
		const rows = await q.execute<{ id: number }>(sql`
				SELECT m.id FROM ${from} WHERE ${where}
				ORDER BY word_similarity(${text}, m.title) DESC, m.created_at DESC, m.id DESC
				${limitOffset(page, FEED_MAX)}
			`);
		return { rows, total: await cappedCount(q, from, where) };
	});
	const ids = rows.map((r) => r.id);
	if (ids.length === 0) return { items: [], total };

	// hideUnderReview: a meme reported over the threshold between ranking and hydration drops out
	// instead of coming back as a placeholder
	const { items } = await getFeedPage({
		viewerId,
		revealAll,
		sort: 'new',
		ids,
		limit: ids.length,
		filter: { hideUnderReview: !revealAll }
	});
	const byId = new Map(items.map((item) => [item.id, item]));
	return {
		items: ids.flatMap((id) => {
			const item = byId.get(id);
			return item ? [item] : [];
		}),
		total
	};
}

// --- tags ------------------------------------------------------------------------------------

/**
 * Tags matching the text with how many memes the viewer can see under each, best match first.
 * Members only get tags with at least one visible meme (a tag carried only by hidden memes would
 * reveal that they exist); moderators get every matching tag.
 */
export async function searchTags(
	revealAll: boolean,
	text: string,
	limit: number
): Promise<{ name: string; count: number }[]> {
	const rows = await withThresholds((q) =>
		q.execute<{ name: string; count: number }>(sql`
			SELECT name, count FROM (
				SELECT t.name,
					(
						SELECT count(*)::int FROM media_tags mt JOIN media m ON m.id = mt.media_id
						WHERE mt.tag_id = t.id
						${revealAll ? sql`` : sql`AND NOT ${underReviewSql('meme', sql`m.id`, sql`m.reviewed_at`)}`}
					) AS count,
					similarity(${text}, t.name) AS score
				FROM tags t
				WHERE ${matchShort(text, sql`t.name`)}
			) matched
			${revealAll ? sql`` : sql`WHERE count > 0`}
			ORDER BY score DESC, name ASC
			LIMIT ${Math.max(Math.trunc(limit), 1)}
		`)
	);
	return rows.map((r) => ({ name: r.name, count: r.count }));
}

// --- people ----------------------------------------------------------------------------------

export interface PersonHit {
	id: number;
	/** What the board shows: the display name, else the username. */
	name: string;
	/** Only filled for moderators and admins. */
	username: string | null;
	role: Role;
	avatarThumbKey: string | null;
}

/**
 * Members by the name the board shows; moderators additionally by username (and get it back).
 * Best match first, then by name.
 */
export async function searchPeople(
	revealAll: boolean,
	text: string,
	page: Page
): Promise<{ items: PersonHit[]; total: number }> {
	const name = sql`coalesce(u.display_name, u.username)`;
	const from = sql`users u`;
	const where = revealAll
		? sql`(${matchShort(text, name)} OR ${matchShort(text, sql`u.username`)})`
		: matchShort(text, name);
	const rank = revealAll
		? sql`GREATEST(similarity(${text}, ${name}), similarity(${text}, u.username))`
		: sql`similarity(${text}, ${name})`;

	const { rows, total } = await withThresholds(async (q) => {
		const rows = await q.execute<{
			id: number;
			name: string;
			username: string;
			role: Role;
			avatar_thumb_key: string | null;
		}>(sql`
			SELECT u.id, ${name} AS name, u.username, u.role, u.avatar_thumb_key
			FROM ${from} WHERE ${where}
			ORDER BY ${rank} DESC, ${name} ASC, u.id ASC
			${limitOffset(page)}
		`);
		return { rows, total: await cappedCount(q, from, where) };
	});
	return {
		items: rows.map((r) => ({
			id: r.id,
			name: r.name,
			username: revealAll ? r.username : null,
			role: r.role,
			avatarThumbKey: r.avatar_thumb_key
		})),
		total
	};
}

// --- comments --------------------------------------------------------------------------------

export interface CommentHit {
	id: number;
	mediaId: number;
	/** The meme's real title: a comment on a meme under review is not listed for members at all. */
	mediaTitle: string;
	author: string;
	authorId: number;
	authorRole: PersonHit['role'];
	authorAvatar: string | null;
	excerpt: string;
	createdAt: string;
}

/** Comments whose text matches, best match first then newest. Hidden comments and comments on hidden memes are left out for members. */
export async function searchComments(
	revealAll: boolean,
	text: string,
	page: Page
): Promise<{ items: CommentHit[]; total: number }> {
	const from = sql`comments c JOIN media m ON m.id = c.media_id JOIN users u ON u.id = c.author_id`;
	const where = sql`${matchLong(text, sql`c.text`)} ${
		revealAll
			? sql``
			: sql`AND NOT ${underReviewSql('comment', sql`c.id`, sql`c.reviewed_at`)}
				AND NOT ${underReviewSql('meme', sql`m.id`, sql`m.reviewed_at`)}`
	}`;

	const { rows, total } = await withThresholds(async (q) => {
		const rows = await q.execute<{
			id: number;
			media_id: number;
			media_title: string;
			author: string;
			author_id: number;
			author_role: Role;
			author_avatar: string | null;
			text: string;
			created_at: Date | string;
		}>(sql`
				SELECT c.id, c.media_id, m.title AS media_title,
					COALESCE(u.display_name, u.username) AS author, u.id AS author_id,
					u.role AS author_role, u.avatar_thumb_key AS author_avatar,
					c.text, c.created_at
				FROM ${from} WHERE ${where}
				ORDER BY word_similarity(${text}, c.text) DESC, c.created_at DESC, c.id DESC
				${limitOffset(page)}
			`);
		return { rows, total: await cappedCount(q, from, where) };
	});
	return {
		items: rows.map((r) => ({
			id: r.id,
			mediaId: r.media_id,
			mediaTitle: r.media_title,
			author: r.author,
			authorId: r.author_id,
			authorRole: r.author_role,
			authorAvatar: r.author_avatar,
			excerpt: excerptAround(r.text, text, 160),
			createdAt: toIso(r.created_at)
		})),
		total
	};
}

// --- quotes ----------------------------------------------------------------------------------

export interface QuoteHit {
	id: number;
	text: string;
	author: string;
	createdAt: string;
}

/** Quotes whose text or author matches, best match first then newest. Hidden quotes are left out for members. */
export async function searchQuotes(
	revealAll: boolean,
	text: string,
	page: Page
): Promise<{ items: QuoteHit[]; total: number }> {
	const from = sql`quotes q`;
	const where = sql`(${matchLong(text, sql`q.text`)} OR ${matchLong(text, sql`q.author`)}) ${
		revealAll ? sql`` : sql`AND NOT ${underReviewSql('quote', sql`q.id`, sql`q.reviewed_at`)}`
	}`;

	const { rows, total } = await withThresholds(async (q) => {
		const rows = await q.execute<{
			id: number;
			text: string;
			author: string;
			created_at: Date | string;
		}>(sql`
				SELECT q.id, q.text, q.author, q.created_at
				FROM ${from} WHERE ${where}
				ORDER BY GREATEST(word_similarity(${text}, q.text), word_similarity(${text}, q.author)) DESC,
					q.created_at DESC, q.id DESC
				${limitOffset(page)}
			`);
		return { rows, total: await cappedCount(q, from, where) };
	});
	return {
		items: rows.map((r) => ({
			id: r.id,
			text: r.text,
			author: r.author,
			createdAt: toIso(r.created_at)
		})),
		total
	};
}
