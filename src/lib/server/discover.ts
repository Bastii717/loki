import { sql } from 'drizzle-orm';
import { db } from './db';
import { getFeedPage, type FeedItem } from './feed';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

const idList = (ids: number[]) =>
	sql.join(
		ids.map((i) => sql`${i}`),
		sql`, `
	);

/**
 * Next batch for the discover pager. Unseen memes (no media_views row for the viewer) come
 * newest first; once none remain, `caughtUp` is true and the batch is a replay of seen memes
 * drawn at random, weighted by score (exponential-race sampling: key = -ln(u) / weight).
 * `exclude` lists ids the client already holds so batches within one session never repeat.
 */
export async function getDiscoverBatch(
	viewerId: number,
	limit = DEFAULT_LIMIT,
	exclude: number[] = []
): Promise<{ items: FeedItem[]; caughtUp: boolean }> {
	const n = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
	const notExcluded = exclude.length > 0 ? sql`AND m.id NOT IN (${idList(exclude)})` : sql``;

	const pick = async (seen: boolean, order: ReturnType<typeof sql>) => {
		const rows = await db.execute<{ id: number }>(sql`
			SELECT m.id FROM media m
			WHERE ${seen ? sql`EXISTS` : sql`NOT EXISTS`} (
				SELECT 1 FROM media_views mv WHERE mv.media_id = m.id AND mv.user_id = ${viewerId}
			) ${notExcluded}
			ORDER BY ${order}
			LIMIT ${n}
		`);
		return [...rows].map((r) => r.id);
	};

	let caughtUp = false;
	let ids = await pick(false, sql`m.created_at DESC, m.id DESC`);
	if (ids.length === 0) {
		caughtUp = true;
		ids = await pick(true, sql`-LN(random()) / (1 + GREATEST(m.score, 0)) ASC`);
	}
	if (ids.length === 0) return { items: [], caughtUp };

	const { items } = await getFeedPage({ viewerId, sort: 'new', ids, limit: ids.length });
	const byId = new Map(items.map((i) => [i.id, i]));
	return { items: ids.flatMap((id) => byId.get(id) ?? []), caughtUp };
}
