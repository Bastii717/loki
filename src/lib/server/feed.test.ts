import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { comments, favorites, media, mediaTags, reports, tags, votes } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { getFeedItem, getFeedPage } from './feed';
import { getDiscoverBatch } from './discover';
import { addOpenReports, OVER_THRESHOLD, timeOut } from './moderation-test-utils';
import { env } from './env';
import { resolveReports } from './moderation';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

let seq = 0;
async function addMedia(
	uploaderId: number,
	over: Partial<typeof media.$inferInsert> = {}
): Promise<number> {
	seq += 1;
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title: `meme ${seq}`,
			kind: 'image',
			objectKey: `memes/o${seq}.webp`,
			thumbKey: `memes/t${seq}.webp`,
			width: 300,
			height: 200,
			...over
		})
		.returning({ id: media.id });
	return row.id;
}

/** 25 memes, one second apart, oldest first. */
async function seed25(uploaderId: number): Promise<number[]> {
	const base = Date.now() - 100_000;
	const ids: number[] = [];
	for (let i = 0; i < 25; i++) {
		ids.push(await addMedia(uploaderId, { createdAt: new Date(base + i * 1000) }));
	}
	return ids;
}

describe('getFeedPage', () => {
	it('pages through 25 memes with disjoint, complete pages (new)', async () => {
		const u = await testUser();
		const ids = await seed25(u.id);
		const p1 = await getFeedPage({ viewerId: u.id, sort: 'new' });
		expect(p1.items).toHaveLength(20);
		expect(p1.nextCursor).not.toBeNull();
		const p2 = await getFeedPage({ viewerId: u.id, sort: 'new', cursor: p1.nextCursor! });
		expect(p2.items).toHaveLength(5);
		expect(p2.nextCursor).toBeNull();
		const got = [...p1.items, ...p2.items].map((i) => i.id);
		expect(got).toEqual([...ids].reverse());
	});

	it('inserting a meme between page fetches neither duplicates nor skips', async () => {
		const u = await testUser();
		const ids = await seed25(u.id);
		const p1 = await getFeedPage({ viewerId: u.id, sort: 'new' });
		const fresh = await addMedia(u.id, { createdAt: new Date() });
		const p2 = await getFeedPage({ viewerId: u.id, sort: 'new', cursor: p1.nextCursor! });
		const got = [...p1.items, ...p2.items].map((i) => i.id);
		expect(new Set(got).size).toBe(got.length);
		expect(got).toEqual([...ids].reverse());
		expect(got).not.toContain(fresh);
	});

	it('keeps microsecond precision across near-identical timestamps', async () => {
		const u = await testUser();
		for (let i = 0; i < 6; i++) await addMedia(u.id); // default now(): microsecond apart
		const seen: number[] = [];
		let cursor: string | undefined;
		do {
			const page = await getFeedPage({ viewerId: u.id, sort: 'new', limit: 2, cursor });
			seen.push(...page.items.map((i) => i.id));
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		expect(seen).toHaveLength(6);
		expect(new Set(seen).size).toBe(6);
	});

	it('breaks score ties by id and orders hof by score desc', async () => {
		const u = await testUser();
		const a = await addMedia(u.id, { score: 5 });
		const b = await addMedia(u.id, { score: 9 });
		const c = await addMedia(u.id, { score: 5 });
		const d = await addMedia(u.id, { score: -1 });
		const all = await getFeedPage({ viewerId: u.id, sort: 'hof' });
		expect(all.items.map((i) => i.id)).toEqual([b, c, a, d]);
		const first = await getFeedPage({ viewerId: u.id, sort: 'hof', limit: 2 });
		const second = await getFeedPage({
			viewerId: u.id,
			sort: 'hof',
			limit: 2,
			cursor: first.nextCursor!
		});
		expect([...first.items, ...second.items].map((i) => i.id)).toEqual([b, c, a, d]);
	});

	it('orders hot by hotScore desc and pages by it', async () => {
		const u = await testUser();
		const a = await addMedia(u.id, { hotScore: 1.5 });
		const b = await addMedia(u.id, { hotScore: 7.123456789012345 });
		const c = await addMedia(u.id, { hotScore: -2.25 });
		const first = await getFeedPage({ viewerId: u.id, sort: 'hot', limit: 1 });
		const second = await getFeedPage({
			viewerId: u.id,
			sort: 'hot',
			limit: 2,
			cursor: first.nextCursor!
		});
		expect([...first.items, ...second.items].map((i) => i.id)).toEqual([b, a, c]);
	});

	it('filters by tag', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		await addMedia(u.id);
		const [t] = await db.insert(tags).values({ name: 'montag' }).returning();
		await db.insert(mediaTags).values({ mediaId: a, tagId: t.id });
		const page = await getFeedPage({ viewerId: u.id, sort: 'new', tag: 'montag' });
		expect(page.items.map((i) => i.id)).toEqual([a]);
		expect(page.items[0].tags).toEqual(['montag']);
	});

	it('blurs nsfw, auto-blurs low scores, then spoilers', async () => {
		const u = await testUser();
		const low = await addMedia(u.id, { score: -5 });
		const edge = await addMedia(u.id, { score: -3 });
		const ok = await addMedia(u.id, { score: -2 });
		const nsfw = await addMedia(u.id, { nsfw: true, spoiler: true });
		const spoiler = await addMedia(u.id, { spoiler: true });
		const page = await getFeedPage({ viewerId: u.id, sort: 'new' });
		const by = Object.fromEntries(page.items.map((i) => [i.id, i.blurred]));
		expect(by[low]).toBe('nsfw');
		expect(by[edge]).toBe('nsfw');
		expect(by[ok]).toBeNull();
		expect(by[nsfw]).toBe('nsfw');
		expect(by[spoiler]).toBe('spoiler');
	});

	it('fills counts, viewer state, urls and uploader', async () => {
		const u = await testUser();
		const other = await testUser();
		const id = await addMedia(u.id, { title: 'Hallo', score: 2, viewCount: 7 });
		const quiet = await addMedia(u.id);
		await db.insert(votes).values([
			{ userId: u.id, mediaId: id, value: -1 },
			{ userId: other.id, mediaId: id, value: 1 }
		]);
		await db.insert(favorites).values([
			{ userId: u.id, mediaId: id },
			{ userId: other.id, mediaId: id }
		]);
		await db.insert(comments).values([
			{ mediaId: id, authorId: other.id, text: 'a' },
			{ mediaId: id, authorId: u.id, text: 'b' }
		]);
		const [t1, t2] = await db
			.insert(tags)
			.values([{ name: 'b' }, { name: 'a' }])
			.returning();
		await db.insert(mediaTags).values([
			{ mediaId: id, tagId: t1.id },
			{ mediaId: id, tagId: t2.id }
		]);

		const mine = (await getFeedPage({ viewerId: u.id, sort: 'new' })).items;
		const item = mine.find((i) => i.id === id)!;
		expect(item).toMatchObject({
			title: 'Hallo',
			kind: 'image',
			width: 300,
			height: 200,
			tags: ['a', 'b'],
			score: 2,
			userVote: -1,
			commentCount: 2,
			favoriteCount: 2,
			userFavorite: true,
			viewCount: 7,
			blurred: null,
			uploader: u.username
		});
		expect(item.thumbUrl).toMatch(/^\/media\/memes\/t\d+\.webp$/);
		expect(item.mediaUrl).toMatch(/^\/media\/memes\/o\d+\.webp$/);
		expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
		const q = mine.find((i) => i.id === quiet)!;
		expect(q).toMatchObject({ userVote: 0, userFavorite: false, commentCount: 0, tags: [] });

		const theirs = (await getFeedPage({ viewerId: other.id, sort: 'new' })).items;
		expect(theirs.find((i) => i.id === id)).toMatchObject({ userVote: 1, userFavorite: true });
	});

	it('rejects a malformed cursor', async () => {
		const u = await testUser();
		await expect(
			getFeedPage({ viewerId: u.id, sort: 'new', cursor: 'not-a-cursor' })
		).rejects.toThrow(/cursor/i);
	});
});

describe('getFeedItem', () => {
	it('returns the one meme with viewer-specific fields, or null', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		await addMedia(u.id);
		await db.insert(votes).values({ userId: u.id, mediaId: a, value: 1 });
		const item = await getFeedItem(u.id, a);
		expect(item).toMatchObject({ id: a, userVote: 1, uploader: u.username });
		expect(item!.mediaUrl).toMatch(/^\/media\//);
		expect(await getFeedItem(u.id, 999999)).toBeNull();
	});

	it("flags the viewer's own memes as mine (report entry is never offered on them)", async () => {
		const owner = await testUser();
		const other = await testUser();
		const id = await addMedia(owner.id);
		expect((await getFeedItem(owner.id, id))!.mine).toBe(true);
		expect((await getFeedItem(other.id, id))!.mine).toBe(false);
	});
});

describe('under review', () => {
	const T = env.REPORT_REVIEW_THRESHOLD;

	async function reportedMeme(reports: number) {
		const author = await testUser();
		const id = await addMedia(author.id, { title: 'secret title' });
		await addOpenReports('meme', id, author.id, reports);
		return { author, id };
	}

	it('exactly at the threshold the meme stays fully visible', async () => {
		const { id } = await reportedMeme(T);
		const viewer = await testUser();
		const item = (await getFeedItem(viewer.id, id))!;
		expect(item.underReview).toBe(false);
		expect(item.title).toBe('secret title');
		expect(item.thumbUrl).toMatch(/^\/media\/memes\/t/);
	});

	it('above the threshold a member gets no urls, title or tags - in feed, detail and discover', async () => {
		const { id, author } = await reportedMeme(OVER_THRESHOLD);
		const [{ id: tagId }] = await db.insert(tags).values({ name: 'geheim' }).returning();
		await db.insert(mediaTags).values({ mediaId: id, tagId });
		const viewer = await testUser();

		const feed = await getFeedPage({ viewerId: viewer.id, sort: 'new' });
		const detail = await getFeedItem(viewer.id, id);
		const discover = await getDiscoverBatch(viewer.id);
		for (const item of [feed.items[0], detail!, discover.items[0]]) {
			expect(item.id).toBe(id);
			expect(item).toMatchObject({
				underReview: true,
				thumbUrl: null,
				mediaUrl: null,
				title: '',
				tags: [],
				uploader: ''
			});
			expect(JSON.stringify(item)).not.toContain('secret title');
			expect(JSON.stringify(item)).not.toContain('memes/');
		}
		// the author is no special case
		const own = await getFeedItem(author.id, id);
		expect(own).toMatchObject({ underReview: true, thumbUrl: null, mediaUrl: null, title: '' });
	});

	it('a moderator (revealAll) gets the full item, flagged', async () => {
		const { id } = await reportedMeme(OVER_THRESHOLD);
		const mod = await testUser({ role: 'moderator' });
		const detail = (await getFeedItem(mod.id, id, true))!;
		expect(detail).toMatchObject({ underReview: true, title: 'secret title' });
		expect(detail.thumbUrl).toMatch(/^\/media\/memes\/t/);
		expect(detail.mediaUrl).toMatch(/^\/media\/memes\/o/);
		const page = await getFeedPage({ viewerId: mod.id, revealAll: true, sort: 'new' });
		expect(page.items[0].mediaUrl).not.toBeNull();
		const discover = await getDiscoverBatch(mod.id, undefined, [], true);
		expect(discover.items[0].mediaUrl).not.toBeNull();
	});

	it('counts distinct reporters, not reports', async () => {
		const author = await testUser();
		const id = await addMedia(author.id);
		const [reporter] = await addOpenReports('meme', id, author.id, 1);
		for (let i = 0; i < T + 2; i++) {
			await db.insert(reports).values({
				contentType: 'meme',
				contentId: id,
				reporterId: reporter,
				authorId: author.id,
				category: 'spam',
				excerpt: 'x'
			});
		}
		expect((await getFeedItem(author.id, id))!.underReview).toBe(false);
	});

	it('reporters with an active timeout do not count', async () => {
		const author = await testUser();
		const id = await addMedia(author.id);
		const reporters = await addOpenReports('meme', id, author.id, OVER_THRESHOLD);
		const viewer = await testUser();
		expect((await getFeedItem(viewer.id, id))!.underReview).toBe(true);
		await timeOut(reporters[0], viewer.id);
		expect((await getFeedItem(viewer.id, id))!.underReview).toBe(false);
	});

	it('resolved reports do not count', async () => {
		const { id } = await reportedMeme(OVER_THRESHOLD);
		const mod = {
			id: (await testUser({ role: 'moderator' })).id,
			username: 'm',
			role: 'moderator' as const
		};
		await resolveReports(mod, 'meme', id, 'actioned');
		expect((await getFeedItem(mod.id, id))!.underReview).toBe(false);
	});

	it('a released meme (reviewedAt) stays visible however many new reports arrive', async () => {
		const { id, author } = await reportedMeme(OVER_THRESHOLD);
		const mod = {
			id: (await testUser({ role: 'moderator' })).id,
			username: 'm',
			role: 'moderator' as const
		};
		await resolveReports(mod, 'meme', id, 'dismissed');
		await addOpenReports('meme', id, author.id, OVER_THRESHOLD + 2);
		const viewer = await testUser();
		const item = (await getFeedItem(viewer.id, id))!;
		expect(item.underReview).toBe(false);
		expect(item.mediaUrl).not.toBeNull();
	});

	it('reports on comments/quotes or other memes do not affect a meme', async () => {
		const author = await testUser();
		const id = await addMedia(author.id);
		const other = await addMedia(author.id);
		await addOpenReports('meme', other, author.id, OVER_THRESHOLD);
		await addOpenReports('comment', id, author.id, OVER_THRESHOLD);
		const items = (await getFeedPage({ viewerId: author.id, sort: 'new' })).items;
		expect(items.find((i) => i.id === id)!.underReview).toBe(false);
		expect(items.find((i) => i.id === other)!.underReview).toBe(true);
	});

	it('a tag filter never matches hidden memes for members (no tag oracle); mods still find them', async () => {
		const { id } = await reportedMeme(OVER_THRESHOLD);
		const [{ id: tagId }] = await db.insert(tags).values({ name: 'geheim' }).returning();
		await db.insert(mediaTags).values({ mediaId: id, tagId });
		const visible = await addMedia((await testUser()).id);
		await db.insert(mediaTags).values({ mediaId: visible, tagId });
		const viewer = await testUser();

		const member = await getFeedPage({ viewerId: viewer.id, sort: 'new', tag: 'geheim' });
		expect(member.items.map((i) => i.id)).toEqual([visible]);
		const mod = await getFeedPage({
			viewerId: viewer.id,
			revealAll: true,
			sort: 'new',
			tag: 'geheim'
		});
		expect(mod.items.map((i) => i.id).sort()).toEqual([id, visible].sort());
		expect(mod.items.find((i) => i.id === id)).toMatchObject({
			title: 'secret title',
			tags: ['geheim']
		});

		// the unfiltered feed still shows the placeholder, without uploader
		const all = await getFeedPage({ viewerId: viewer.id, sort: 'new' });
		expect(all.items.find((i) => i.id === id)).toMatchObject({ underReview: true, uploader: '' });
	});

	it('a released meme is findable by tag again', async () => {
		const { id } = await reportedMeme(OVER_THRESHOLD);
		const [{ id: tagId }] = await db.insert(tags).values({ name: 'x' }).returning();
		await db.insert(mediaTags).values({ mediaId: id, tagId });
		const mod = await testUser({ role: 'moderator' });
		await resolveReports(
			{ id: mod.id, username: mod.username, role: 'moderator' },
			'meme',
			id,
			'dismissed'
		);
		const viewer = await testUser();
		const page = await getFeedPage({ viewerId: viewer.id, sort: 'new', tag: 'x' });
		expect(page.items.map((i) => i.id)).toEqual([id]);
	});
});
