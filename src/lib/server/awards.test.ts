import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	AWARD_KIND,
	awardDueMonths,
	awardsOf,
	berlinMonth,
	findWinner,
	leadingNow,
	listAwards,
	monthsBetween,
	monthStart,
	nextMonth
} from './awards';
import { db } from './db';
import { awards, media, notifications, votes } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { addOpenReports, insertComment, OVER_THRESHOLD } from './moderation-test-utils';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const NOW = new Date('2026-11-03T12:00:00Z');

let counter = 0;
/** Inserts a meme with a fixed creation instant and score. */
async function meme(
	uploaderId: number,
	createdAt: string,
	score: number,
	title = `Meme ${++counter}`
): Promise<number> {
	const key = `memes/uaward/${crypto.randomUUID()}`;
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title,
			kind: 'image',
			objectKey: `${key}.webp`,
			thumbKey: `${key}-t.webp`,
			score,
			createdAt: new Date(createdAt)
		})
		.returning({ id: media.id });
	return row.id;
}

/** The public id of a meme row. */
async function publicOf(id: number): Promise<string> {
	const [row] = await db.select({ publicId: media.publicId }).from(media).where(eq(media.id, id));
	return row.publicId;
}

async function awardRows() {
	return db.select().from(awards).orderBy(awards.month);
}

async function noticeRows() {
	return db.select().from(notifications).orderBy(notifications.id);
}

describe('month helpers', () => {
	it('puts a meme at 23:30 Berlin on 31 Oct in October and one at 00:10 Berlin on 1 Nov in November', () => {
		// Berlin is on CET (UTC+1) from 25 Oct 2026
		expect(berlinMonth(new Date('2026-10-31T22:30:00Z'))).toBe('2026-10');
		expect(berlinMonth(new Date('2026-10-31T23:10:00Z'))).toBe('2026-11');
	});

	it('reads the month in Berlin summer time too', () => {
		expect(berlinMonth(new Date('2026-07-31T21:59:00Z'))).toBe('2026-07');
		expect(berlinMonth(new Date('2026-07-31T22:00:00Z'))).toBe('2026-08');
	});

	it('lists the months from the first up to, excluding, the last', () => {
		expect(monthsBetween('2026-08', '2026-11')).toEqual(['2026-08', '2026-09', '2026-10']);
		expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01']);
		expect(monthsBetween('2026-11', '2026-11')).toEqual([]);
		expect(monthsBetween('2026-12', '2026-11')).toEqual([]);
	});

	it('steps to the next month across a year boundary', () => {
		expect(nextMonth('2026-10')).toBe('2026-11');
		expect(nextMonth('2026-12')).toBe('2027-01');
	});

	it('starts a month at 00:00 Berlin, as a UTC instant', () => {
		expect(monthStart('2026-11').toISOString()).toBe('2026-10-31T23:00:00.000Z');
		expect(monthStart('2026-07').toISOString()).toBe('2026-06-30T22:00:00.000Z');
		expect(monthStart('2027-01').toISOString()).toBe('2026-12-31T23:00:00.000Z');
	});

	it('rejects a malformed month', () => {
		expect(() => monthStart('2026-13')).toThrow(RangeError);
		expect(() => nextMonth('2026-1')).toThrow(RangeError);
	});

	it('rejects year 0000 and years below 1000, which Postgres cannot cast', () => {
		expect(() => monthStart('0000-01')).toThrow(RangeError);
		expect(() => nextMonth('0999-12')).toThrow(RangeError);
		expect(() => monthsBetween('0000-01', '2026-01')).toThrow(RangeError);
		expect(nextMonth('1000-12')).toBe('1001-01');
	});
});

describe('findWinner', () => {
	it('picks the highest score of the month', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-10T10:00:00Z', 3);
		const top = await meme(user.id, '2026-10-11T10:00:00Z', 7, 'Top');
		await meme(user.id, '2026-10-12T10:00:00Z', 5);
		expect(await findWinner('2026-10')).toEqual({
			mediaId: top,
			mediaPublicId: await publicOf(top),
			uploaderId: user.id,
			title: 'Top',
			score: 7
		});
	});

	it('breaks a score tie by comment count', async () => {
		const user = await testUser();
		const quiet = await meme(user.id, '2026-10-10T10:00:00Z', 5);
		const loud = await meme(user.id, '2026-10-20T10:00:00Z', 5);
		await insertComment(user.id, loud);
		await insertComment(user.id, loud);
		await insertComment(user.id, quiet);
		expect((await findWinner('2026-10'))?.mediaId).toBe(loud);
	});

	it('breaks a score and comment tie by age, older first', async () => {
		const user = await testUser();
		const newer = await meme(user.id, '2026-10-20T10:00:00Z', 5);
		const older = await meme(user.id, '2026-10-10T10:00:00Z', 5);
		// the older meme has the higher id, so only the age can decide
		expect(newer).toBeLessThan(older);
		expect((await findWinner('2026-10'))?.mediaId).toBe(older);
	});

	it('breaks a full tie by id, lower first', async () => {
		const user = await testUser();
		const first = await meme(user.id, '2026-10-10T10:00:00Z', 5);
		const second = await meme(user.id, '2026-10-10T10:00:00Z', 5);
		expect(first).toBeLessThan(second);
		expect((await findWinner('2026-10'))?.mediaId).toBe(first);
	});

	it('skips a meme under review', async () => {
		const user = await testUser();
		const hidden = await meme(user.id, '2026-10-10T10:00:00Z', 9);
		const visible = await meme(user.id, '2026-10-11T10:00:00Z', 2);
		await addOpenReports('meme', hidden, user.id, OVER_THRESHOLD);
		expect((await findWinner('2026-10'))?.mediaId).toBe(visible);
	});

	it('counts a meme a moderator released after review again', async () => {
		const user = await testUser();
		const released = await meme(user.id, '2026-10-10T10:00:00Z', 9);
		await addOpenReports('meme', released, user.id, OVER_THRESHOLD);
		await db.update(media).set({ reviewedAt: new Date() }).where(eq(media.id, released));
		expect((await findWinner('2026-10'))?.mediaId).toBe(released);
	});

	it('returns null when the best score is 0 or below, or the month has no meme', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-10T10:00:00Z', 0);
		await meme(user.id, '2026-10-11T10:00:00Z', -2);
		expect(await findWinner('2026-10')).toBeNull();
		expect(await findWinner('2026-09')).toBeNull();
	});

	it('keeps the month edges in Berlin time', async () => {
		const user = await testUser();
		const lastMinute = await meme(user.id, '2026-10-31T22:30:00Z', 4, 'October');
		const firstMinute = await meme(user.id, '2026-10-31T23:10:00Z', 9, 'November');
		expect((await findWinner('2026-10'))?.mediaId).toBe(lastMinute);
		expect((await findWinner('2026-11'))?.mediaId).toBe(firstMinute);
	});
});

describe('awardDueMonths', () => {
	it('returns nothing on an empty board', async () => {
		expect(await awardDueMonths(NOW)).toEqual([]);
		expect(await awardRows()).toEqual([]);
	});

	it('awards the previous month and tells the winner', async () => {
		const winner = await testUser();
		const other = await testUser();
		const id = await meme(winner.id, '2026-10-12T10:00:00Z', 6, 'The one: with a colon');
		await meme(other.id, '2026-10-13T10:00:00Z', 4);
		const result = await awardDueMonths(NOW);
		expect(result).toEqual([
			{
				month: '2026-10',
				winner: {
					mediaId: id,
					mediaPublicId: await publicOf(id),
					uploaderId: winner.id,
					title: 'The one: with a colon',
					score: 6
				}
			}
		]);
		const [row] = await awardRows();
		expect(row).toMatchObject({
			kind: AWARD_KIND,
			month: '2026-10-01',
			mediaId: id,
			uploaderId: winner.id,
			title: 'The one: with a colon',
			score: 6
		});
		const notices = await noticeRows();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatchObject({
			userId: winner.id,
			kind: 'award_won',
			actorId: null,
			contentType: 'meme',
			contentId: id,
			mediaId: id,
			detail: '2026-10:The one: with a colon',
			count: 1
		});
	});

	it('does not evaluate the running month', async () => {
		const user = await testUser();
		await meme(user.id, '2026-11-01T10:00:00Z', 8);
		expect(await awardDueMonths(NOW)).toEqual([]);
		expect(await awardRows()).toEqual([]);
	});

	it('writes a no-winner row for a month with only score-0 memes', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-12T10:00:00Z', 0);
		expect(await awardDueMonths(NOW)).toEqual([{ month: '2026-10', winner: null }]);
		const [row] = await awardRows();
		expect(row).toMatchObject({
			month: '2026-10-01',
			mediaId: null,
			uploaderId: null,
			title: '',
			score: 0
		});
		expect(await noticeRows()).toHaveLength(0);
	});

	it('writes a no-winner row for a month whose only good meme is under review', async () => {
		const user = await testUser();
		const hidden = await meme(user.id, '2026-10-12T10:00:00Z', 9);
		await addOpenReports('meme', hidden, user.id, OVER_THRESHOLD);
		await awardDueMonths(NOW);
		const [row] = await awardRows();
		expect(row.mediaId).toBeNull();
		expect(await noticeRows()).toHaveLength(0);
	});

	it('catches up three months and notifies only for the one that ended within 31 days', async () => {
		const user = await testUser();
		const august = await meme(user.id, '2026-08-05T10:00:00Z', 3, 'August');
		const september = await meme(user.id, '2026-09-05T10:00:00Z', 3, 'September');
		const october = await meme(user.id, '2026-10-05T10:00:00Z', 3, 'October');
		const result = await awardDueMonths(NOW);
		expect(result.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
		expect((await awardRows()).map((r) => [r.month, r.mediaId])).toEqual([
			['2026-08-01', august],
			['2026-09-01', september],
			['2026-10-01', october]
		]);
		const notices = await noticeRows();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatchObject({ mediaId: october, detail: '2026-10:October' });
	});

	it('catches up the months an earlier run left open', async () => {
		const user = await testUser();
		await meme(user.id, '2026-08-05T10:00:00Z', 3);
		await meme(user.id, '2026-09-05T10:00:00Z', 3);
		await awardDueMonths(new Date('2026-09-02T00:00:00Z'));
		expect((await awardRows()).map((r) => r.month)).toEqual(['2026-08-01']);
		const result = await awardDueMonths(NOW);
		expect(result.map((r) => r.month)).toEqual(['2026-09', '2026-10']);
	});

	it('counts the 31 day notice window from the end of the month', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-05T10:00:00Z', 3);
		// October ends at 2026-10-31T23:00Z; 30 days and one hour later it still counts
		await awardDueMonths(new Date('2026-12-01T00:00:00Z'));
		expect(await noticeRows()).toHaveLength(1);
	});

	it('awards without a notice once the month ended 31 days ago or more', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-05T10:00:00Z', 3);
		await awardDueMonths(new Date('2026-12-02T00:00:00Z'));
		expect(await noticeRows()).toHaveLength(0);
		// October with its winner, November without one
		expect((await awardRows()).map((r) => [r.month, r.mediaId === null])).toEqual([
			['2026-10-01', false],
			['2026-11-01', true]
		]);
	});

	it('inserts nothing and notifies nobody on a second run', async () => {
		const user = await testUser();
		await meme(user.id, '2026-08-05T10:00:00Z', 3);
		await meme(user.id, '2026-10-05T10:00:00Z', 3);
		await awardDueMonths(NOW);
		const rowsBefore = await awardRows();
		const noticesBefore = await noticeRows();
		expect(await awardDueMonths(NOW)).toEqual([]);
		expect(await awardRows()).toEqual(rowsBefore);
		expect(await noticeRows()).toEqual(noticesBefore);
	});

	it('yields one row and one notice when two runs happen in parallel', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-05T10:00:00Z', 3);
		await Promise.all([awardDueMonths(NOW), awardDueMonths(NOW)]);
		expect(await awardRows()).toHaveLength(1);
		expect(await noticeRows()).toHaveLength(1);
	});

	it('does not flip a no-winner month when a vote arrives later', async () => {
		const user = await testUser();
		const id = await meme(user.id, '2026-10-05T10:00:00Z', 0);
		await awardDueMonths(NOW);
		await db.update(media).set({ score: 5 }).where(eq(media.id, id));
		await db.insert(votes).values({ mediaId: id, userId: user.id, value: 1 });
		expect(await awardDueMonths(NOW)).toEqual([]);
		const [row] = await awardRows();
		expect(row.mediaId).toBeNull();
		expect(await noticeRows()).toHaveLength(0);
	});

	it('keeps the row, title and score of a winner that is deleted later', async () => {
		const user = await testUser();
		const id = await meme(user.id, '2026-10-05T10:00:00Z', 4, 'Gone soon');
		await awardDueMonths(NOW);
		await db.delete(media).where(eq(media.id, id));
		expect(await awardDueMonths(NOW)).toEqual([]);
		const [row] = await awardRows();
		expect(row).toMatchObject({
			mediaId: null,
			uploaderId: user.id,
			title: 'Gone soon',
			score: 4
		});
	});

	it('starts at the Berlin month of the oldest meme', async () => {
		const user = await testUser();
		// 22:10 UTC on 31 Jul is 00:10 on 1 Aug in Berlin
		await meme(user.id, '2026-07-31T22:10:00Z', 3);
		const result = await awardDueMonths(NOW);
		expect(result.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
	});

	it('stores the rows under the award kind', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-05T10:00:00Z', 3);
		await awardDueMonths(NOW);
		const [{ n }] = await db.execute<{ n: number }>(
			sql`SELECT count(*)::int AS n FROM awards WHERE kind = 'meme_of_the_month'`
		);
		expect(n).toBe(1);
	});
});

/** Inserts an award row directly. */
async function award(
	month: string,
	values: Partial<typeof awards.$inferInsert> = {}
): Promise<void> {
	await db.insert(awards).values({ month: `${month}-01`, title: '', score: 0, ...values });
}

describe('listAwards', () => {
	async function seedMonths() {
		const user = await testUser();
		const ids: Record<string, number> = {};
		for (const [m, score] of [
			['2026-06', 3],
			['2026-07', 4],
			['2026-08', 5],
			['2026-10', 7]
		] as const) {
			ids[m] = await meme(user.id, `${m}-10T10:00:00Z`, score, `Title ${m}`);
			await award(m, { mediaId: ids[m], uploaderId: user.id, title: `Title ${m}`, score });
		}
		// September had no winner
		await award('2026-09');
		return { user, ids };
	}

	it('lists winner rows newest first and leaves out no-winner months', async () => {
		const { user, ids } = await seedMonths();
		const { rows, hasMore } = await listAwards({ limit: 10 });
		expect(hasMore).toBe(false);
		expect(rows.map((r) => r.month)).toEqual(['2026-10', '2026-08', '2026-07', '2026-06']);
		expect(rows[0]).toEqual({
			month: '2026-10',
			mediaId: ids['2026-10'],
			mediaPublicId: await publicOf(ids['2026-10']),
			uploaderId: user.id,
			title: 'Title 2026-10',
			score: 7
		});
	});

	it('keeps a deleted winner (title, no media) and a winner with an empty title', async () => {
		const user = await testUser();
		await award('2026-08', { uploaderId: user.id, title: 'Deleted one', score: 4 });
		const id = await meme(user.id, '2026-09-10T10:00:00Z', 2, '');
		await award('2026-09', { mediaId: id, uploaderId: user.id, title: '', score: 2 });
		await award('2026-10');
		const { rows } = await listAwards({ limit: 10 });
		expect(rows.map((r) => [r.month, r.mediaId === null])).toEqual([
			['2026-09', false],
			['2026-08', true]
		]);
		expect(rows[1].title).toBe('Deleted one');
	});

	it('keeps a winner with an empty title whose meme was deleted', async () => {
		const user = await testUser();
		await award('2026-08', { uploaderId: user.id, title: '', score: 2 });
		await award('2026-09');
		const { rows } = await listAwards({ limit: 10 });
		expect(rows).toEqual([
			{
				month: '2026-08',
				mediaId: null,
				mediaPublicId: null,
				uploaderId: user.id,
				title: '',
				score: 2
			}
		]);
	});

	it('pages with limit and reports hasMore', async () => {
		await seedMonths();
		const first = await listAwards({ limit: 2 });
		expect(first.rows.map((r) => r.month)).toEqual(['2026-10', '2026-08']);
		expect(first.hasMore).toBe(true);
		const second = await listAwards({ limit: 2, before: '2026-08' });
		expect(second.rows.map((r) => r.month)).toEqual(['2026-07', '2026-06']);
		expect(second.hasMore).toBe(false);
	});

	it('starts at the given month, inclusive, with from', async () => {
		await seedMonths();
		const { rows, hasMore } = await listAwards({ limit: 2, from: '2026-08' });
		expect(rows.map((r) => r.month)).toEqual(['2026-08', '2026-07']);
		expect(hasMore).toBe(true);
		// a from on a month without a winner starts at the next earlier winner
		const gap = await listAwards({ limit: 10, from: '2026-09' });
		expect(gap.rows.map((r) => r.month)).toEqual(['2026-08', '2026-07', '2026-06']);
	});

	it('returns nothing without awards', async () => {
		expect(await listAwards({ limit: 5 })).toEqual({ rows: [], hasMore: false });
	});
});

describe('awardsOf', () => {
	it('lists the months a member won, newest first, without no-winner rows', async () => {
		const winner = await testUser();
		const other = await testUser();
		await award('2026-06', { uploaderId: winner.id, title: 'a', score: 1 });
		await award('2026-08', { uploaderId: winner.id, title: 'b', score: 1 });
		await award('2026-07', { uploaderId: other.id, title: 'c', score: 1 });
		await award('2026-09');
		expect(await awardsOf(winner.id)).toEqual([{ month: '2026-08' }, { month: '2026-06' }]);
		expect(await awardsOf(other.id)).toEqual([{ month: '2026-07' }]);
		const nobody = await testUser();
		expect(await awardsOf(nobody.id)).toEqual([]);
	});

	it('counts a winner with an empty title whose meme was deleted', async () => {
		const user = await testUser();
		await award('2026-08', { uploaderId: user.id, title: '', score: 2 });
		expect(await awardsOf(user.id)).toEqual([{ month: '2026-08' }]);
	});
});

describe('leadingNow', () => {
	it('names the best eligible meme of the running month and stores nothing', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-20T10:00:00Z', 50);
		const id = await meme(user.id, '2026-11-02T10:00:00Z', 3, 'Leader');
		await meme(user.id, '2026-11-02T11:00:00Z', 1);
		expect(await leadingNow(NOW)).toEqual({
			month: '2026-11',
			mediaId: id,
			mediaPublicId: await publicOf(id),
			uploaderId: user.id,
			title: 'Leader',
			score: 3
		});
		expect(await awardRows()).toEqual([]);
	});

	it('is null when no eligible meme has a positive score this month', async () => {
		const user = await testUser();
		await meme(user.id, '2026-10-20T10:00:00Z', 50);
		await meme(user.id, '2026-11-02T10:00:00Z', 0);
		expect(await leadingNow(NOW)).toBeNull();
	});
});
