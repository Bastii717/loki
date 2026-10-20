import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { comments, favorites, media, mediaTags, tags, votes } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { getFeedPage } from './feed';

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
