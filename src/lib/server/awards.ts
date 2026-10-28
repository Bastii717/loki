import { and, asc, desc, eq, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { awards, comments, media } from './db/schema';
import { fromBerlinLocal } from './berlin-time';
import { underReviewSql, type Executor } from './moderation';
import { notify } from './notifications';

export const AWARD_KIND = 'meme_of_the_month';
/** A winner is only told about the award when its month ended less than this many days ago. */
export const NOTICE_WINDOW_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const berlinParts = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Europe/Berlin',
	year: 'numeric',
	month: '2-digit'
});

function parseMonth(month: string): [number, number] {
	const m = MONTH.exec(month);
	if (!m) throw new RangeError(`Not a month (YYYY-MM): ${month}`);
	return [Number(m[1]), Number(m[2])];
}

const formatMonth = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** The Berlin calendar month of an instant, `YYYY-MM`. */
export function berlinMonth(date: Date): string {
	const p: Record<string, string> = {};
	for (const part of berlinParts.formatToParts(date)) p[part.type] = part.value;
	return `${p.year}-${p.month}`;
}

/** The month after `month` (`YYYY-MM`). */
export function nextMonth(month: string): string {
	const [year, m] = parseMonth(month);
	return m === 12 ? formatMonth(year + 1, 1) : formatMonth(year, m + 1);
}

/** The UTC instant at which `month` starts: 00:00 Berlin time on its first day. */
export function monthStart(month: string): Date {
	parseMonth(month);
	return fromBerlinLocal(`${month}-01T00:00`);
}

/** The months from `first` up to, but not including, `lastExclusive`. */
export function monthsBetween(first: string, lastExclusive: string): string[] {
	parseMonth(first);
	parseMonth(lastExclusive);
	const months: string[] = [];
	// `YYYY-MM` strings sort like the months they name
	for (let m = first; m < lastExclusive; m = nextMonth(m)) months.push(m);
	return months;
}

export interface Winner {
	mediaId: number;
	uploaderId: number;
	title: string;
	score: number;
}

/**
 * The meme of `month` (Berlin calendar): the highest score among memes not under review, then the
 * most comments, then the oldest, then the lowest id. Null when no eligible meme scores above 0.
 */
export async function findWinner(month: string, tx: Executor = db): Promise<Winner | null> {
	parseMonth(month);
	// compared in Berlin wall-clock time, so the edges move with summer time
	const wall = sql`${media.createdAt} AT TIME ZONE 'Europe/Berlin'`;
	const [row] = await tx
		.select({
			mediaId: media.id,
			uploaderId: media.uploaderId,
			title: media.title,
			score: media.score
		})
		.from(media)
		.where(
			and(
				sql`${wall} >= ${`${month}-01`}::timestamp`,
				sql`${wall} < ${`${nextMonth(month)}-01`}::timestamp`,
				sql`NOT ${underReviewSql('meme', media.id, media.reviewedAt)}`
			)
		)
		.orderBy(
			desc(media.score),
			desc(sql`(SELECT count(*) FROM ${comments} WHERE ${comments.mediaId} = ${media.id})`),
			asc(media.createdAt),
			asc(media.id)
		)
		.limit(1);
	return row && row.score > 0 ? row : null;
}

/**
 * Awards every Berlin month before `now`'s month, from the month of the oldest meme on, that has
 * no award row yet: the winner, or a no-winner row so the month is never evaluated twice. A winner
 * is notified only when the month ended less than NOTICE_WINDOW_DAYS before `now`. One transaction
 * per month; two runs at once leave one row and one notice. Returns the months evaluated here.
 */
export async function awardDueMonths(
	now = new Date()
): Promise<{ month: string; winner: Winner | null }[]> {
	const [oldest] = await db.select({ at: sql<Date | null>`min(${media.createdAt})` }).from(media);
	if (!oldest?.at) return [];

	const done = await db
		.select({ month: sql<string>`to_char(${awards.month}, 'YYYY-MM')` })
		.from(awards)
		.where(eq(awards.kind, AWARD_KIND));
	const awarded = new Set(done.map((r) => r.month));
	const due = monthsBetween(berlinMonth(new Date(oldest.at)), berlinMonth(now)).filter(
		(m) => !awarded.has(m)
	);

	const evaluated: { month: string; winner: Winner | null }[] = [];
	for (const month of due) {
		const winner = await db.transaction(async (tx) => {
			const found = await findWinner(month, tx);
			const [inserted] = await tx
				.insert(awards)
				.values({
					kind: AWARD_KIND,
					month: `${month}-01`,
					mediaId: found?.mediaId ?? null,
					uploaderId: found?.uploaderId ?? null,
					title: found?.title ?? '',
					score: found?.score ?? 0
				})
				.onConflictDoNothing({ target: [awards.kind, awards.month] })
				.returning({ id: awards.id });
			if (!inserted) return undefined; // another run got there first
			const monthEnded = monthStart(nextMonth(month)).getTime();
			if (found && now.getTime() - monthEnded < NOTICE_WINDOW_DAYS * DAY_MS) {
				await notify(tx, {
					userId: found.uploaderId,
					kind: 'award_won',
					actorId: null,
					contentType: 'meme',
					contentId: found.mediaId,
					mediaId: found.mediaId,
					detail: `${month}:${found.title}`
				});
			}
			return found;
		});
		if (winner !== undefined) evaluated.push({ month, winner });
	}
	return evaluated;
}

export interface AwardRow {
	month: string;
	mediaId: number | null;
	uploaderId: number | null;
	title: string;
	score: number;
}

/** Winner rows only (no-winner months are skipped); a deleted winner stays, with its title. */
const isWinnerRow = or(isNotNull(awards.mediaId), sql`${awards.title} <> ''`);

/**
 * Awarded months, newest first. `before` lists strictly earlier months, `from` starts at that
 * month (inclusive) and goes back; `hasMore` tells whether older winners remain.
 */
export async function listAwards(opts: {
	before?: string;
	from?: string;
	limit: number;
}): Promise<{ rows: AwardRow[]; hasMore: boolean }> {
	const conditions: (SQL | undefined)[] = [eq(awards.kind, AWARD_KIND), isWinnerRow];
	if (opts.before !== undefined) {
		parseMonth(opts.before);
		conditions.push(sql`${awards.month} < ${`${opts.before}-01`}::date`);
	}
	if (opts.from !== undefined) {
		parseMonth(opts.from);
		conditions.push(sql`${awards.month} <= ${`${opts.from}-01`}::date`);
	}
	const rows = await db
		.select({
			month: sql<string>`to_char(${awards.month}, 'YYYY-MM')`,
			mediaId: awards.mediaId,
			uploaderId: awards.uploaderId,
			title: awards.title,
			score: awards.score
		})
		.from(awards)
		.where(and(...conditions))
		.orderBy(desc(awards.month))
		.limit(opts.limit + 1);
	return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

/** The months a member won, newest first. */
export async function awardsOf(userId: number): Promise<{ month: string }[]> {
	return db
		.select({ month: sql<string>`to_char(${awards.month}, 'YYYY-MM')` })
		.from(awards)
		.where(and(eq(awards.kind, AWARD_KIND), eq(awards.uploaderId, userId), isWinnerRow))
		.orderBy(desc(awards.month));
}

/** Who leads the running month right now; nothing is stored. */
export async function leadingNow(now = new Date()): Promise<(Winner & { month: string }) | null> {
	const month = berlinMonth(now);
	const winner = await findWinner(month);
	return winner ? { month, ...winner } : null;
}
