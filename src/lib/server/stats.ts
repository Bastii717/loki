import { desc, eq, not, sql } from 'drizzle-orm';
import { db } from './db';
import { media, mediaTags, tags, users } from './db/schema';
import { underReviewSql } from './moderation';

export type Stats = {
	uploadsPerWeek: { week: string; count: number }[];
	topUploaders: { username: string; count: number }[];
	topVoted: { id: number; title: string; score: number }[];
	topTags: { name: string; count: number }[];
};

const TOP = 5;
const WEEKS = 8;

/** Last 8 ISO weeks (UTC, oldest first, zero-filled), as `YYYY-Www`. */
async function uploadsPerWeek(): Promise<Stats['uploadsPerWeek']> {
	const rows = await db.execute<{ week: string; count: number }>(sql`
		select to_char(w.start, 'IYYY-"W"IW') as week, count(m.id)::int as count
		from generate_series(
			date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => ${WEEKS - 1}),
			date_trunc('week', now() at time zone 'UTC'),
			interval '1 week'
		) as w(start)
		left join media m on date_trunc('week', m.created_at at time zone 'UTC') = w.start
		group by w.start
		order by w.start
	`);
	return rows.map((r) => ({ week: r.week, count: r.count }));
}

export async function getStats(): Promise<Stats> {
	const uploaderCount = sql<number>`count(${media.id})::int`;
	const tagCount = sql<number>`count(${mediaTags.mediaId})::int`;

	const [weekly, topUploaders, topVoted, topTags] = await Promise.all([
		uploadsPerWeek(),
		db
			.select({ username: users.username, count: uploaderCount })
			.from(media)
			.innerJoin(users, eq(users.id, media.uploaderId))
			.groupBy(users.id, users.username)
			.orderBy(desc(uploaderCount), users.id)
			.limit(TOP),
		db
			.select({ id: media.id, title: media.title, score: media.score })
			.from(media)
			// titles of memes under review must not leak through the stats page
			.where(not(underReviewSql('meme', media.id, media.reviewedAt)))
			.orderBy(desc(media.score), media.id)
			.limit(TOP),
		db
			.select({ name: tags.name, count: tagCount })
			.from(mediaTags)
			.innerJoin(tags, eq(tags.id, mediaTags.tagId))
			.groupBy(tags.id, tags.name)
			.orderBy(desc(tagCount), tags.name)
			.limit(TOP)
	]);

	return { uploadsPerWeek: weekly, topUploaders, topVoted, topTags };
}
