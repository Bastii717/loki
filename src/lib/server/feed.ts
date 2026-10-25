import { sql } from 'drizzle-orm';
import { db } from './db';
import { env } from './env';
import { openReporterCountSelect, overThresholdSql } from './moderation';

export type FeedSort = 'new' | 'hot' | 'hof';

export interface FeedItem {
	id: number;
	title: string;
	kind: 'image' | 'gif' | 'video';
	/** null while under review, for viewers who may not see it. */
	thumbUrl: string | null;
	mediaUrl: string | null;
	width: number | null;
	height: number | null;
	tags: string[];
	score: number;
	userVote: -1 | 0 | 1;
	commentCount: number;
	favoriteCount: number;
	userFavorite: boolean;
	viewCount: number;
	blurred: 'nsfw' | 'spoiler' | null;
	uploader: string;
	/** The viewer uploaded this meme (never offer "Report" on it). */
	mine: boolean;
	createdAt: string;
	/**
	 * Hidden by report threshold and not yet released. Non-moderators get empty title/tags/uploader and null
	 * URLs (enforced here, not in the UI); moderators get the full item with this flag set.
	 */
	underReview: boolean;
}

export interface FeedOptions {
	viewerId: number;
	/** Moderators/admins: return under-review content in full (pass `canSeeUnderReview(user)`). Default false = hidden. */
	revealAll?: boolean;
	sort: FeedSort;
	tag?: string;
	cursor?: string;
	limit?: number;
	/** Restrict to a single meme (detail view); sort/cursor are then irrelevant. */
	id?: number;
	/** Restrict to these memes (discover hydrates its own selection); ordering is the caller's job. */
	ids?: number[];
	/** Profile lists: only memes uploaded by `uploaderId` / favorited by `favoriteOf` (viewer state stays the viewer's). */
	filter?: { uploaderId?: number; favoriteOf?: number };
}

export class InvalidCursorError extends Error {
	constructor() {
		super('Invalid cursor');
	}
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface Cursor {
	v: number | string;
	id: number;
}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string, sort: FeedSort): Cursor {
	try {
		const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
		const valueOk =
			sort === 'new'
				? typeof c.v === 'string' && !Number.isNaN(Date.parse(c.v))
				: typeof c.v === 'number' && Number.isFinite(c.v);
		if (valueOk && Number.isInteger(c.id)) return { v: c.v, id: c.id };
	} catch {
		// fall through
	}
	throw new InvalidCursorError();
}

/** Query-string sort value to FeedSort; unknown values fall back to `new`. */
export function parseSort(raw: string | null): FeedSort {
	return raw === 'hot' || raw === 'hof' ? raw : 'new';
}

/** Normalises a `?tag=` value the way tags are stored (lowercase, no leading #). */
export function parseTag(raw: string | null): string | undefined {
	const tag = (raw ?? '').trim().toLowerCase().replace(/^#/, '');
	return tag !== '' && tag.length <= 30 ? tag : undefined;
}

interface Row extends Record<string, unknown> {
	id: number;
	title: string;
	kind: FeedItem['kind'];
	object_key: string;
	thumb_key: string;
	width: number | null;
	height: number | null;
	nsfw: boolean;
	spoiler: boolean;
	score: number;
	view_count: number;
	hot_score: number;
	created_at: Date | string;
	created_at_raw: string;
	uploader: string;
	mine: boolean;
	tag_names: string[];
	comment_count: number;
	favorite_count: number;
	user_vote: number;
	user_favorite: boolean;
	under_review: boolean;
}

/**
 * One page of the feed. A single statement with lateral aggregates (no per-row queries);
 * keyset pagination on (sort key, id). Optional filters (`tag`, `id`, `ids`, `filter.uploaderId`,
 * `filter.favoriteOf`) only narrow the row set; ordering and cursors are unaffected. `created_at` travels in the cursor as Postgres' own
 * text form so microsecond precision survives (a JS Date would truncate to milliseconds).
 */
export async function getFeedPage(opts: FeedOptions): Promise<{
	items: FeedItem[];
	nextCursor: string | null;
}> {
	const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
	const cursor = opts.cursor ? decodeCursor(opts.cursor, opts.sort) : null;

	const keyCol = sql.raw(
		opts.sort === 'new' ? 'm.created_at' : opts.sort === 'hot' ? 'm.hot_score' : 'm.score'
	);
	const keyType = sql.raw(
		opts.sort === 'new' ? 'timestamptz' : opts.sort === 'hot' ? 'double precision' : 'integer'
	);

	const after = cursor
		? sql`AND (${keyCol}, m.id) < (${cursor.v}::${keyType}, ${cursor.id}::integer)`
		: sql``;
	const tagFilter = opts.tag
		? sql`AND EXISTS (
			SELECT 1 FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
			WHERE mt.media_id = m.id AND t.name = ${opts.tag}
		)
		${
			// A tag filter would otherwise act as an oracle for the tags of hidden items.
			opts.revealAll
				? sql``
				: sql`AND NOT (m.reviewed_at IS NULL AND ${overThresholdSql(sql`rc.n`)})`
		}`
		: sql``;

	const idFilter = opts.id !== undefined ? sql`AND m.id = ${opts.id}` : sql``;

	const idsFilter =
		opts.ids !== undefined
			? sql`AND m.id IN (${sql.join(
					opts.ids.map((i) => sql`${i}`),
					sql`, `
				)})`
			: sql``;

	const uploaderFilter =
		opts.filter?.uploaderId !== undefined
			? sql`AND m.uploader_id = ${opts.filter.uploaderId}`
			: sql``;
	const favoriteFilter =
		opts.filter?.favoriteOf !== undefined
			? sql`AND EXISTS (
				SELECT 1 FROM favorites ff WHERE ff.media_id = m.id AND ff.user_id = ${opts.filter.favoriteOf}
			)`
			: sql``;

	const rows = await db.execute<Row>(sql`
		SELECT m.id, m.title, m.kind, m.object_key, m.thumb_key, m.width, m.height,
			m.nsfw, m.spoiler, m.score, m.view_count, m.hot_score, m.created_at,
			m.created_at::text AS created_at_raw,
			u.username AS uploader,
			(m.uploader_id = ${opts.viewerId}) AS mine,
			COALESCE(tg.names, ARRAY[]::text[]) AS tag_names,
			cc.n AS comment_count,
			fc.n AS favorite_count,
			COALESCE(v.value, 0) AS user_vote,
			(uf.user_id IS NOT NULL) AS user_favorite,
			(m.reviewed_at IS NULL AND ${overThresholdSql(sql`rc.n`)}) AS under_review
		FROM media m
		JOIN users u ON u.id = m.uploader_id
		LEFT JOIN LATERAL (
			SELECT array_agg(t.name ORDER BY t.name) AS names
			FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
			WHERE mt.media_id = m.id
		) tg ON true
		LEFT JOIN LATERAL (
			SELECT count(*)::int AS n FROM comments c WHERE c.media_id = m.id
		) cc ON true
		LEFT JOIN LATERAL (
			SELECT count(*)::int AS n FROM favorites f WHERE f.media_id = m.id
		) fc ON true
		LEFT JOIN LATERAL (
			${openReporterCountSelect('meme', sql`m.id`)}
		) rc ON true
		LEFT JOIN votes v ON v.media_id = m.id AND v.user_id = ${opts.viewerId}
		LEFT JOIN favorites uf ON uf.media_id = m.id AND uf.user_id = ${opts.viewerId}
		WHERE true ${after} ${tagFilter} ${idFilter} ${idsFilter} ${uploaderFilter} ${favoriteFilter}
		ORDER BY ${keyCol} DESC, m.id DESC
		LIMIT ${limit + 1}
	`);

	const page = [...rows];
	const hasMore = page.length > limit;
	if (hasMore) page.length = limit;

	const items: FeedItem[] = page.map((r) => {
		const hide = r.under_review && !opts.revealAll;
		return {
			id: r.id,
			title: hide ? '' : r.title,
			kind: r.kind,
			thumbUrl: hide ? null : `/media/${r.thumb_key}`,
			mediaUrl: hide ? null : `/media/${r.object_key}`,
			width: r.width,
			height: r.height,
			tags: hide ? [] : r.tag_names,
			score: r.score,
			userVote: r.user_vote as FeedItem['userVote'],
			commentCount: r.comment_count,
			favoriteCount: r.favorite_count,
			userFavorite: r.user_favorite,
			viewCount: r.view_count,
			blurred: r.nsfw || r.score <= env.AUTO_BLUR_SCORE ? 'nsfw' : r.spoiler ? 'spoiler' : null,
			uploader: hide ? '' : r.uploader,
			mine: r.mine,
			createdAt: new Date(r.created_at).toISOString(),
			underReview: r.under_review
		};
	});

	let nextCursor: string | null = null;
	if (hasMore) {
		const last = page[page.length - 1];
		const v =
			opts.sort === 'new' ? last.created_at_raw : opts.sort === 'hot' ? last.hot_score : last.score;
		nextCursor = encodeCursor({ v, id: last.id });
	}
	return { items, nextCursor };
}

/** A single meme in feed-item shape, or null when it does not exist. */
export async function getFeedItem(
	viewerId: number,
	id: number,
	revealAll = false
): Promise<FeedItem | null> {
	const { items } = await getFeedPage({ viewerId, revealAll, sort: 'new', id, limit: 1 });
	return items[0] ?? null;
}
