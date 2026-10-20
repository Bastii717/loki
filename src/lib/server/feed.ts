import { sql } from 'drizzle-orm';
import { db } from './db';
import { env } from './env';

export type FeedSort = 'new' | 'hot' | 'hof';

export interface FeedItem {
	id: number;
	title: string;
	kind: 'image' | 'gif' | 'video';
	thumbUrl: string;
	mediaUrl: string;
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
	createdAt: string;
}

export interface FeedOptions {
	viewerId: number;
	sort: FeedSort;
	tag?: string;
	cursor?: string;
	limit?: number;
	/** Restrict to a single meme (detail view); sort/cursor are then irrelevant. */
	id?: number;
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
	tag_names: string[];
	comment_count: number;
	favorite_count: number;
	user_vote: number;
	user_favorite: boolean;
}

/**
 * One page of the feed. A single statement with lateral aggregates (no per-row queries);
 * keyset pagination on (sort key, id). `created_at` travels in the cursor as Postgres' own
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
		)`
		: sql``;

	const idFilter = opts.id !== undefined ? sql`AND m.id = ${opts.id}` : sql``;

	const rows = await db.execute<Row>(sql`
		SELECT m.id, m.title, m.kind, m.object_key, m.thumb_key, m.width, m.height,
			m.nsfw, m.spoiler, m.score, m.view_count, m.hot_score, m.created_at,
			m.created_at::text AS created_at_raw,
			u.username AS uploader,
			COALESCE(tg.names, ARRAY[]::text[]) AS tag_names,
			cc.n AS comment_count,
			fc.n AS favorite_count,
			COALESCE(v.value, 0) AS user_vote,
			(uf.user_id IS NOT NULL) AS user_favorite
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
		LEFT JOIN votes v ON v.media_id = m.id AND v.user_id = ${opts.viewerId}
		LEFT JOIN favorites uf ON uf.media_id = m.id AND uf.user_id = ${opts.viewerId}
		WHERE true ${after} ${tagFilter} ${idFilter}
		ORDER BY ${keyCol} DESC, m.id DESC
		LIMIT ${limit + 1}
	`);

	const page = [...rows];
	const hasMore = page.length > limit;
	if (hasMore) page.length = limit;

	const items: FeedItem[] = page.map((r) => ({
		id: r.id,
		title: r.title,
		kind: r.kind,
		thumbUrl: `/media/${r.thumb_key}`,
		mediaUrl: `/media/${r.object_key}`,
		width: r.width,
		height: r.height,
		tags: r.tag_names,
		score: r.score,
		userVote: r.user_vote as FeedItem['userVote'],
		commentCount: r.comment_count,
		favoriteCount: r.favorite_count,
		userFavorite: r.user_favorite,
		viewCount: r.view_count,
		blurred: r.nsfw || r.score <= env.AUTO_BLUR_SCORE ? 'nsfw' : r.spoiler ? 'spoiler' : null,
		uploader: r.uploader,
		createdAt: new Date(r.created_at).toISOString()
	}));

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
export async function getFeedItem(viewerId: number, id: number): Promise<FeedItem | null> {
	const { items } = await getFeedPage({ viewerId, sort: 'new', id, limit: 1 });
	return items[0] ?? null;
}
