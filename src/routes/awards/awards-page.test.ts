import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/server/db';
import { awards, media } from '../../lib/server/db/schema';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import type { FeedItem } from '../../lib/server/feed';
import {
	addOpenReports,
	insertMeme,
	OVER_THRESHOLD,
	userWithSession
} from '../../lib/server/moderation-test-utils';
import { callRoute } from '../../lib/server/test-request';
import { load } from './+page.server';

beforeAll(setupDb);
beforeEach(resetDb);
afterEach(() => vi.useRealTimers());

/** Freezes `new Date()` only; timers stay real so database calls keep working. */
const freeze = (iso: string) => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(iso));
};

type Member = Awaited<ReturnType<typeof userWithSession>>;
interface Data {
	leading: { month: string; item: FeedItem; score: number } | null;
	sections: { month: string; item: FeedItem | null }[];
	hasMore: boolean;
	nextBefore: string | null;
	firstClose: string;
}

/** The page load for `viewer`, called directly (callRoute only returns Responses). */
const loadFor = (viewer: Member, query = '') =>
	load({
		locals: { user: viewer.user },
		url: new URL(`https://loki.test/awards${query}`)
	} as never) as Promise<Data>;

/** A winner row for `month` (`YYYY-MM`); `mediaId` may be null for a deleted meme. */
async function award(
	month: string,
	values: Partial<typeof awards.$inferInsert> = {}
): Promise<void> {
	await db.insert(awards).values({ month: `${month}-01`, title: '', score: 0, ...values });
}

/** The public id of a meme row (feed items carry it, never the internal id). */
async function publicOf(id: number): Promise<string> {
	const [row] = await db.select({ publicId: media.publicId }).from(media).where(eq(media.id, id));
	return row.publicId;
}

async function winner(uploaderId: number, month: string, title = `Title ${month}`) {
	const id = await insertMeme(uploaderId, title);
	await award(month, { mediaId: id, uploaderId, title, score: 5 });
	return id;
}

describe('awards page load', () => {
	it('sends an anonymous request to the login page', async () => {
		const res = await callRoute({ handler: load, path: '/awards' });
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toContain('/login');
	});

	it('lists the winners newest first with their hydrated cards', async () => {
		const viewer = await userWithSession();
		const author = await userWithSession();
		const aug = await winner(author.user.id, '2026-08');
		const oct = await winner(author.user.id, '2026-10');
		const sep = await winner(author.user.id, '2026-09');
		const data = await loadFor(viewer);
		expect(data.sections.map((s) => [s.month, s.item?.id])).toEqual([
			['2026-10', await publicOf(oct)],
			['2026-09', await publicOf(sep)],
			['2026-08', await publicOf(aug)]
		]);
		// no internal id anywhere in the payload
		expect(JSON.stringify(data)).not.toMatch(/"(id|uploaderId|mediaId)":\d/);
		expect(data.sections[0].item).toMatchObject({ title: 'Title 2026-10', awardMonth: '2026-10' });
		expect(data.hasMore).toBe(false);
		expect(data.nextBefore).toBeNull();
	});

	it('keeps a deleted winner as a row without a card and without its title', async () => {
		const viewer = await userWithSession();
		const author = await userWithSession();
		const id = await winner(author.user.id, '2026-09', 'Gone soon');
		await winner(author.user.id, '2026-08');
		await db.delete(media).where(eq(media.id, id));
		const data = await loadFor(viewer);
		expect(data.sections.map((s) => [s.month, s.item === null])).toEqual([
			['2026-09', true],
			['2026-08', false]
		]);
		expect(Object.keys(data.sections[0]).sort()).toEqual(['item', 'month']);
	});

	it('never puts the title of a deleted winner into a member payload', async () => {
		const viewer = await userWithSession();
		const author = await userWithSession();
		const id = await winner(author.user.id, '2026-09', 'Deleted secret title');
		await db.delete(media).where(eq(media.id, id));
		// the stored copy survives for the audit trail, but the page never reads it out
		const [row] = await db.select().from(awards);
		expect(row.title).toBe('Deleted secret title');
		const data = await loadFor(viewer);
		expect(data.sections).toEqual([{ month: '2026-09', item: null }]);
		expect(JSON.stringify(data)).not.toContain('Deleted secret title');
	});

	it('skips months without a winner', async () => {
		const viewer = await userWithSession();
		const author = await userWithSession();
		await winner(author.user.id, '2026-08');
		await award('2026-09');
		const data = await loadFor(viewer);
		expect(data.sections.map((s) => s.month)).toEqual(['2026-08']);
	});

	it('pages with before and starts at a month with from', async () => {
		const viewer = await userWithSession();
		const author = await userWithSession();
		for (let m = 1; m <= 14; m++) {
			const month = m <= 12 ? `2025-${String(m).padStart(2, '0')}` : `2026-0${m - 12}`;
			await winner(author.user.id, month);
		}
		const first = await loadFor(viewer);
		expect(first.sections).toHaveLength(12);
		expect(first.sections[0].month).toBe('2026-02');
		expect(first.hasMore).toBe(true);
		expect(first.nextBefore).toBe('2025-03');

		const second = await loadFor(viewer, `?before=${first.nextBefore}`);
		expect(second.sections.map((s) => s.month)).toEqual(['2025-02', '2025-01']);
		expect(second.hasMore).toBe(false);
		expect(second.nextBefore).toBeNull();

		const from = await loadFor(viewer, '?from=2025-02');
		expect(from.sections.map((s) => s.month)).toEqual(['2025-02', '2025-01']);
	});

	it.each(['2026-13', 'soon', '2026-1', '2026-10-01', '', '0000-01', '0999-12'])(
		'ignores a bad month %j',
		async (bad) => {
			const viewer = await userWithSession();
			const author = await userWithSession();
			await winner(author.user.id, '2026-08');
			for (const key of ['before', 'from']) {
				const data = await loadFor(viewer, `?${key}=${encodeURIComponent(bad)}`);
				expect(data.sections.map((s) => s.month)).toEqual(['2026-08']);
			}
		}
	);

	it('shows who leads this month, and nobody when no meme scores', async () => {
		freeze('2026-10-28T10:00:00Z');
		const viewer = await userWithSession();
		const author = await userWithSession();
		const id = await insertMeme(author.user.id, 'Running hot');
		await db
			.update(media)
			.set({ createdAt: new Date('2026-10-20T08:00:00Z') })
			.where(eq(media.id, id));
		expect((await loadFor(viewer)).leading).toBeNull();

		await db
			.update(media)
			.set({ score: 3, createdAt: new Date('2026-10-20T08:00:00Z') })
			.where(eq(media.id, id));
		const data = await loadFor(viewer);
		expect(data.leading).toMatchObject({ month: '2026-10', score: 3 });
		expect(data.leading?.item).toMatchObject({ id: await publicOf(id), title: 'Running hot' });
	});

	it('shows the leader on the first page only', async () => {
		freeze('2026-10-28T10:00:00Z');
		const viewer = await userWithSession();
		const author = await userWithSession();
		const id = await insertMeme(author.user.id, 'Running hot');
		await db
			.update(media)
			.set({ score: 3, createdAt: new Date('2026-10-20T08:00:00Z') })
			.where(eq(media.id, id));
		await winner(author.user.id, '2026-08');
		expect((await loadFor(viewer)).leading).toMatchObject({ month: '2026-10' });
		expect((await loadFor(viewer, '?before=2026-10')).leading).toBeNull();
		expect((await loadFor(viewer, '?from=2026-08')).leading).toBeNull();
		// an ignored bad month is no page switch
		expect((await loadFor(viewer, '?before=nope')).leading).toMatchObject({ month: '2026-10' });
	});

	it('gives the first close as the start of next month', async () => {
		const viewer = await userWithSession();
		// 23:30 UTC on 31 October is already 1 November in Berlin, so November is the running month
		freeze('2026-10-31T23:30:00Z');
		expect((await loadFor(viewer)).firstClose).toBe('2026-11-30T23:00:00.000Z');
		// summer time: the end of June is 22:00 UTC
		freeze('2026-06-15T12:00:00Z');
		expect((await loadFor(viewer)).firstClose).toBe('2026-06-30T22:00:00.000Z');
	});

	it('hands a member a placeholder for a past winner hidden for review, a moderator the card', async () => {
		const viewer = await userWithSession();
		const mod = await userWithSession('moderator');
		const author = await userWithSession();
		const id = await winner(author.user.id, '2026-09', 'Secret winner');
		await addOpenReports('meme', id, author.user.id, OVER_THRESHOLD);

		const asMember = await loadFor(viewer);
		expect(asMember.sections).toHaveLength(1);
		expect(asMember.sections[0].item).toMatchObject({
			id: await publicOf(id),
			underReview: true,
			title: ''
		});
		expect(JSON.stringify(asMember)).not.toContain('Secret winner');

		const asMod = await loadFor(mod);
		expect(asMod.sections[0].item).toMatchObject({
			id: await publicOf(id),
			underReview: true,
			title: 'Secret winner'
		});
	});
});
