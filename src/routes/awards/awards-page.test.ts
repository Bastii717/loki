import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { berlinMonth } from '../../lib/server/awards';
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

type Member = Awaited<ReturnType<typeof userWithSession>>;
interface Data {
	leading: { month: string; item: FeedItem; score: number } | null;
	sections: { month: string; item: FeedItem | null; title: string }[];
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
		expect(data.sections.map((s) => [s.month, s.item?.id, s.title])).toEqual([
			['2026-10', oct, 'Title 2026-10'],
			['2026-09', sep, 'Title 2026-09'],
			['2026-08', aug, 'Title 2026-08']
		]);
		expect(data.sections[0].item).toMatchObject({ title: 'Title 2026-10', awardMonth: '2026-10' });
		expect(data.hasMore).toBe(false);
		expect(data.nextBefore).toBeNull();
	});

	it('keeps a deleted winner as a row without a card, with its title', async () => {
		const viewer = await userWithSession();
		const author = await userWithSession();
		const id = await winner(author.user.id, '2026-09', 'Gone soon');
		await winner(author.user.id, '2026-08');
		await db.delete(media).where(eq(media.id, id));
		const data = await loadFor(viewer);
		expect(data.sections.map((s) => [s.month, s.item === null, s.title])).toEqual([
			['2026-09', true, 'Gone soon'],
			['2026-08', false, 'Title 2026-08']
		]);
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

	it.each(['2026-13', 'soon', '2026-1', '2026-10-01', ''])(
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
		const viewer = await userWithSession();
		const author = await userWithSession();
		const id = await insertMeme(author.user.id, 'Running hot');
		expect((await loadFor(viewer)).leading).toBeNull();

		await db.update(media).set({ score: 3 }).where(eq(media.id, id));
		const data = await loadFor(viewer);
		expect(data.leading).toMatchObject({ month: berlinMonth(new Date()), score: 3 });
		expect(data.leading?.item).toMatchObject({ id, title: 'Running hot' });
	});

	it('gives the first close as the start of next month', async () => {
		const viewer = await userWithSession();
		const data = await loadFor(viewer);
		const close = new Date(data.firstClose);
		expect(close.getTime()).toBeGreaterThan(Date.now());
		expect(berlinMonth(new Date(close.getTime() - 1))).toBe(berlinMonth(new Date()));
		expect(berlinMonth(close)).not.toBe(berlinMonth(new Date()));
	});

	it('hands a member a placeholder for a past winner hidden for review, a moderator the card', async () => {
		const viewer = await userWithSession();
		const mod = await userWithSession('moderator');
		const author = await userWithSession();
		const id = await winner(author.user.id, '2026-09', 'Secret winner');
		await addOpenReports('meme', id, author.user.id, OVER_THRESHOLD);

		const asMember = await loadFor(viewer);
		expect(asMember.sections).toHaveLength(1);
		expect(asMember.sections[0].item).toMatchObject({ id, underReview: true, title: '' });
		expect(asMember.sections[0].title).toBe('');
		expect(JSON.stringify(asMember)).not.toContain('Secret winner');

		const asMod = await loadFor(mod);
		expect(asMod.sections[0].item).toMatchObject({ id, underReview: true, title: 'Secret winner' });
		expect(asMod.sections[0].title).toBe('Secret winner');
	});
});
