import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { awards, comments, favorites, media, mediaTags, reports, tags, votes } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { getFeedItem, getFeedItemById, getFeedPage } from './feed';
import { isPublicId } from './public-ids';
import { getDiscoverBatch } from './discover';
import { addOpenReports, OVER_THRESHOLD, timeOut } from './moderation-test-utils';
import { env } from './env';
import { resolveReports } from './moderation';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

let seq = 0;
/** Internal id behind each inserted meme's public id (reports and other FKs still take the number). */
const internal = new Map<string, number>();
const inner = (pid: string) => internal.get(pid)!;

/** Inserts a meme and returns its public id, the only id the feed exposes. */
async function addMedia(
	uploaderId: number,
	over: Partial<typeof media.$inferInsert> = {}
): Promise<string> {
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
		.returning({ id: media.id, publicId: media.publicId });
	internal.set(row.publicId, row.id);
	return row.publicId;
}

/** 25 memes, one second apart, oldest first. */
async function seed25(uploaderId: number): Promise<string[]> {
	const base = Date.now() - 100_000;
	const ids: string[] = [];
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
		const seen: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await getFeedPage({ viewerId: u.id, sort: 'new', limit: 2, cursor });
			seen.push(...page.items.map((i) => i.id));
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		expect(seen).toHaveLength(6);
		expect(new Set(seen).size).toBe(6);
	});

	it('breaks score ties by public id and orders hof by score desc', async () => {
		const u = await testUser();
		const a = await addMedia(u.id, { score: 5 });
		const b = await addMedia(u.id, { score: 9 });
		const c = await addMedia(u.id, { score: 5 });
		const d = await addMedia(u.id, { score: -1 });
		const all = await getFeedPage({ viewerId: u.id, sort: 'hof' });
		// a and c tie on score: the keyset tiebreak is the public id, descending
		const tied = [a, c].sort().reverse();
		expect(all.items.map((i) => i.id)).toEqual([b, ...tied, d]);
		const first = await getFeedPage({ viewerId: u.id, sort: 'hof', limit: 2 });
		const second = await getFeedPage({
			viewerId: u.id,
			sort: 'hof',
			limit: 2,
			cursor: first.nextCursor!
		});
		expect([...first.items, ...second.items].map((i) => i.id)).toEqual([b, ...tied, d]);
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
		await db.insert(mediaTags).values({ mediaId: inner(a), tagId: t.id });
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
			{ userId: u.id, mediaId: inner(id), value: -1 },
			{ userId: other.id, mediaId: inner(id), value: 1 }
		]);
		await db.insert(favorites).values([
			{ userId: u.id, mediaId: inner(id) },
			{ userId: other.id, mediaId: inner(id) }
		]);
		await db.insert(comments).values([
			{ mediaId: inner(id), authorId: other.id, text: 'a' },
			{ mediaId: inner(id), authorId: u.id, text: 'b' }
		]);
		const [t1, t2] = await db
			.insert(tags)
			.values([{ name: 'b' }, { name: 'a' }])
			.returning();
		await db.insert(mediaTags).values([
			{ mediaId: inner(id), tagId: t1.id },
			{ mediaId: inner(id), tagId: t2.id }
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

	it('shows the display name when set, else the username, with role and avatar thumb', async () => {
		const named = await testUser({
			displayName: 'Ronja',
			displayNameKey: 'ronja',
			role: 'moderator',
			avatarThumbKey: 'avatars/ronja-thumb.webp'
		});
		const plain = await testUser();
		const a = await addMedia(named.id);
		const b = await addMedia(plain.id);
		const items = (await getFeedPage({ viewerId: plain.id, sort: 'new' })).items;
		expect(items.find((i) => i.id === a)).toMatchObject({
			uploader: 'Ronja',
			uploaderRole: 'moderator',
			uploaderAvatar: 'avatars/ronja-thumb.webp'
		});
		expect(items.find((i) => i.id === b)).toMatchObject({
			uploader: plain.username,
			uploaderRole: 'member',
			uploaderAvatar: null
		});
		expect(await getFeedItem(plain.id, false, a)).toMatchObject({ uploader: 'Ronja' });
	});

	it('exposes public ids only: id and uploaderId are 12-character strings, no internal id in the JSON', async () => {
		const u = await testUser();
		const pid = await addMedia(u.id);
		const page = await getFeedPage({ viewerId: u.id, sort: 'new' });
		expect(page.items[0].id).toBe(pid);
		expect(page.items[0].uploaderId).toBe(u.publicId);
		expect(isPublicId(page.items[0].id)).toBe(true);
		const json = JSON.stringify(page);
		expect(json).not.toMatch(new RegExp(`"id":${inner(pid)}[,}]`));
		expect(json).not.toMatch(new RegExp(`"uploaderId":${u.id}[,}]`));
	});

	it('embeds the public id in the cursor and keeps the internal id out of it', async () => {
		const user = await testUser();
		await seed25(user.id);
		for (const sort of ['new', 'hot', 'hof'] as const) {
			const p1 = await getFeedPage({ viewerId: user.id, sort, limit: 2 });
			const payload = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8'));
			expect(payload.id).toBe(p1.items[1].id);
			expect(isPublicId(payload.id)).toBe(true);
		}
	});

	it('orders rows with an identical sort key by public id descending across pages', async () => {
		const u = await testUser();
		const at = new Date(Date.now() - 5000);
		const pids: string[] = [];
		for (let i = 0; i < 6; i++) pids.push(await addMedia(u.id, { createdAt: at }));
		const got: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await getFeedPage({ viewerId: u.id, sort: 'new', limit: 2, cursor });
			got.push(...page.items.map((i) => i.id));
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		expect(got).toEqual([...pids].sort().reverse());
	});

	it('rejects a cursor whose tiebreak is not a public id', async () => {
		const u = await testUser();
		const forged = (c: unknown) => Buffer.from(JSON.stringify(c)).toString('base64url');
		for (const bad of [
			{ v: new Date().toISOString(), id: 5 },
			{ v: new Date().toISOString(), id: 'short' },
			{ v: new Date().toISOString(), id: "AAAAAAAAAAA'" }
		]) {
			await expect(
				getFeedPage({ viewerId: u.id, sort: 'new', cursor: forged(bad) })
			).rejects.toThrow(/cursor/i);
		}
	});

	it('rejects a malformed cursor', async () => {
		const u = await testUser();
		await expect(
			getFeedPage({ viewerId: u.id, sort: 'new', cursor: 'not-a-cursor' })
		).rejects.toThrow(/cursor/i);
	});
});

describe('uploaderId and the uploader filter', () => {
	it('returns the uploader id of a visible meme', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		const viewer = await testUser();
		expect((await getFeedItem(viewer.id, false, id))!.uploaderId).toBe(u.publicId);
	});

	it('hideUnderReview drops hidden memes from the row set, so cursors stay valid', async () => {
		const author = await testUser();
		const base = Date.now() - 100_000;
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			ids.push(await addMedia(author.id, { createdAt: new Date(base + i * 1000) }));
		}
		await addOpenReports('meme', inner(ids[3]), author.id, OVER_THRESHOLD);
		const viewer = await testUser();
		const filter = { uploaderId: author.id, hideUnderReview: true };
		const p1 = await getFeedPage({ viewerId: viewer.id, sort: 'new', filter, limit: 2 });
		expect(p1.items.map((i) => i.id)).toEqual([ids[4], ids[2]]);
		const p2 = await getFeedPage({
			viewerId: viewer.id,
			sort: 'new',
			filter,
			limit: 2,
			cursor: p1.nextCursor!
		});
		expect(p2.items.map((i) => i.id)).toEqual([ids[1], ids[0]]);
		expect(p2.nextCursor).toBeNull();
		// without the flag the hidden one stays as a placeholder row
		const all = await getFeedPage({
			viewerId: viewer.id,
			sort: 'new',
			filter: { uploaderId: author.id }
		});
		expect(all.items.map((i) => i.id)).toContain(ids[3]);
	});
});

describe('the ids option', () => {
	it('takes public ids and returns the items in the requested order', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		const b = await addMedia(u.id);
		const c = await addMedia(u.id);
		await addMedia(u.id);
		for (const order of [
			[b, a, c],
			[c, b, a],
			[a, c]
		]) {
			const { items } = await getFeedPage({
				viewerId: u.id,
				sort: 'new',
				ids: order,
				limit: order.length
			});
			expect(items.map((i) => i.id)).toEqual(order);
		}
	});

	it('skips unknown ids and an empty list returns nothing', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		const { items } = await getFeedPage({
			viewerId: u.id,
			sort: 'new',
			ids: ['AAAAAAAAAAAA', a],
			limit: 2
		});
		expect(items.map((i) => i.id)).toEqual([a]);
		expect((await getFeedPage({ viewerId: u.id, sort: 'new', ids: [], limit: 1 })).items).toEqual(
			[]
		);
	});

	it('hides nothing extra and nothing less: under-review items stay masked, uploaderId null', async () => {
		const author = await testUser();
		const hidden = await addMedia(author.id, { title: 'secret title' });
		const open = await addMedia(author.id, { title: 'open title' });
		await addOpenReports('meme', inner(hidden), author.id, OVER_THRESHOLD);
		const viewer = await testUser();
		const { items } = await getFeedPage({
			viewerId: viewer.id,
			sort: 'new',
			ids: [hidden, open],
			limit: 2
		});
		expect(items.map((i) => i.id)).toEqual([hidden, open]);
		expect(items[0]).toMatchObject({ underReview: true, title: '', uploaderId: null });
		expect(items[1]).toMatchObject({ title: 'open title', uploaderId: author.publicId });
		expect(JSON.stringify(items)).not.toContain('secret title');
	});

	it('a numeric string is not an id: nothing matches', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		const { items } = await getFeedPage({
			viewerId: u.id,
			sort: 'new',
			ids: [String(inner(a))],
			limit: 1
		});
		expect(items).toEqual([]);
	});
});

describe('getFeedItem', () => {
	it('returns the one meme with viewer-specific fields, or null', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		await addMedia(u.id);
		await db.insert(votes).values({ userId: u.id, mediaId: inner(a), value: 1 });
		const item = await getFeedItem(u.id, false, a);
		expect(item).toMatchObject({ id: a, userVote: 1, uploader: u.username });
		expect(item!.mediaUrl).toMatch(/^\/media\//);
		expect(await getFeedItem(u.id, false, 'AAAAAAAAAAAA')).toBeNull();
		// a numeric id is not a public id, so getFeedItem finds nothing for it
		expect(await getFeedItem(u.id, false, String(inner(a)))).toBeNull();
	});

	it('getFeedItemById serves server callers that hold the internal id', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		const item = await getFeedItemById(u.id, false, inner(a));
		expect(item).toMatchObject({ id: a, uploaderId: u.publicId });
		expect(await getFeedItemById(u.id, false, 999999)).toBeNull();
	});

	it("flags the viewer's own memes as mine (report entry is never offered on them)", async () => {
		const owner = await testUser();
		const other = await testUser();
		const id = await addMedia(owner.id);
		expect((await getFeedItem(owner.id, false, id))!.mine).toBe(true);
		expect((await getFeedItem(other.id, false, id))!.mine).toBe(false);
	});
});

describe('awardMonth', () => {
	async function award(mediaId: string, month: string, kind = 'meme_of_the_month') {
		await db
			.insert(awards)
			.values({ kind, month: `${month}-01`, mediaId: inner(mediaId), title: 't', score: 3 });
	}

	it('is the award month for the winner and null for every other meme', async () => {
		const u = await testUser();
		const winner = await addMedia(u.id);
		const other = await addMedia(u.id);
		await award(winner, '2026-10');
		const feed = await getFeedPage({ viewerId: u.id, sort: 'new' });
		expect(feed.items.find((i) => i.id === winner)!.awardMonth).toBe('2026-10');
		expect(feed.items.find((i) => i.id === other)!.awardMonth).toBeNull();
		expect((await getFeedItem(u.id, false, winner))!.awardMonth).toBe('2026-10');
	});

	it('ignores other award kinds', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		await award(id, '2026-10', 'other_kind');
		expect((await getFeedItem(u.id, false, id))!.awardMonth).toBeNull();
	});

	it('takes the newest month and returns one row when a meme holds two awards', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		await award(id, '2026-08');
		await award(id, '2026-10');
		const feed = await getFeedPage({ viewerId: u.id, sort: 'new' });
		expect(feed.items.filter((i) => i.id === id)).toHaveLength(1);
		expect(feed.items[0].awardMonth).toBe('2026-10');
	});

	it('is null when the meme is hidden for the viewer, set for a moderator', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		await award(id, '2026-10');
		await addOpenReports('meme', inner(id), u.id, OVER_THRESHOLD);
		const viewer = await testUser();
		expect((await getFeedItem(viewer.id, false, id))!.awardMonth).toBeNull();
		expect((await getFeedItem(viewer.id, true, id))!.awardMonth).toBe('2026-10');
	});
});

describe('under review', () => {
	const T = env.REPORT_REVIEW_THRESHOLD;

	async function reportedMeme(
		reports: number,
		authorOverrides: Parameters<typeof testUser>[0] = {}
	) {
		const author = await testUser(authorOverrides);
		const id = await addMedia(author.id, { title: 'secret title' });
		await addOpenReports('meme', inner(id), author.id, reports);
		return { author, id };
	}

	it('exactly at the threshold the meme stays fully visible', async () => {
		const { id } = await reportedMeme(T);
		const viewer = await testUser();
		const item = (await getFeedItem(viewer.id, false, id))!;
		expect(item.underReview).toBe(false);
		expect(item.title).toBe('secret title');
		expect(item.thumbUrl).toMatch(/^\/media\/memes\/t/);
	});

	it('above the threshold a member gets no urls, title or tags - in feed, detail and discover', async () => {
		const { id, author } = await reportedMeme(OVER_THRESHOLD, {
			role: 'moderator',
			avatarThumbKey: 'avatars/u9/x-64.webp'
		});
		const [{ id: tagId }] = await db.insert(tags).values({ name: 'geheim' }).returning();
		await db.insert(mediaTags).values({ mediaId: inner(id), tagId });
		const viewer = await testUser();

		const feed = await getFeedPage({ viewerId: viewer.id, sort: 'new' });
		const detail = await getFeedItem(viewer.id, false, id);
		const discover = await getDiscoverBatch(viewer.id);
		for (const item of [feed.items[0], detail!, discover.items[0]]) {
			expect(item.id).toBe(id);
			expect(item).toMatchObject({
				underReview: true,
				thumbUrl: null,
				mediaUrl: null,
				title: '',
				tags: [],
				uploader: '',
				uploaderRole: 'member',
				uploaderAvatar: null,
				uploaderId: null
			});
			expect(JSON.stringify(item)).not.toContain('secret title');
			expect(JSON.stringify(item)).not.toContain('avatars/');
			expect(JSON.stringify(item)).not.toContain('memes/');
		}
		// the author is no special case
		const own = await getFeedItem(author.id, false, id);
		expect(own).toMatchObject({ underReview: true, thumbUrl: null, mediaUrl: null, title: '' });
	});

	it('a moderator (revealAll) gets the full item, flagged', async () => {
		const { id, author } = await reportedMeme(OVER_THRESHOLD, {
			role: 'moderator',
			avatarThumbKey: 'avatars/u9/x-64.webp'
		});
		const mod = await testUser({ role: 'moderator' });
		const detail = (await getFeedItem(mod.id, true, id))!;
		expect(detail).toMatchObject({
			underReview: true,
			title: 'secret title',
			uploader: author.username,
			uploaderRole: 'moderator',
			uploaderAvatar: 'avatars/u9/x-64.webp',
			uploaderId: author.publicId
		});
		expect(detail.thumbUrl).toMatch(/^\/media\/memes\/t/);
		expect(detail.mediaUrl).toMatch(/^\/media\/memes\/o/);
		const page = await getFeedPage({ viewerId: mod.id, revealAll: true, sort: 'new' });
		expect(page.items[0].mediaUrl).not.toBeNull();
		expect(page.items[0]).toMatchObject({
			uploaderRole: 'moderator',
			uploaderAvatar: 'avatars/u9/x-64.webp'
		});
		const discover = await getDiscoverBatch(mod.id, undefined, [], true);
		expect(discover.items[0].mediaUrl).not.toBeNull();
		expect(discover.items[0]).toMatchObject({
			uploaderRole: 'moderator',
			uploaderAvatar: 'avatars/u9/x-64.webp'
		});
	});

	it('counts distinct reporters, not reports', async () => {
		const author = await testUser();
		const id = await addMedia(author.id);
		const [reporter] = await addOpenReports('meme', inner(id), author.id, 1);
		for (let i = 0; i < T + 2; i++) {
			await db.insert(reports).values({
				contentType: 'meme',
				contentId: inner(id),
				reporterId: reporter,
				authorId: author.id,
				category: 'spam',
				excerpt: 'x'
			});
		}
		expect((await getFeedItem(author.id, false, id))!.underReview).toBe(false);
	});

	it('reporters with an active timeout do not count', async () => {
		const author = await testUser();
		const id = await addMedia(author.id);
		const reporters = await addOpenReports('meme', inner(id), author.id, OVER_THRESHOLD);
		const viewer = await testUser();
		expect((await getFeedItem(viewer.id, false, id))!.underReview).toBe(true);
		await timeOut(reporters[0], viewer.id);
		expect((await getFeedItem(viewer.id, false, id))!.underReview).toBe(false);
	});

	it('resolved reports do not count', async () => {
		const { id } = await reportedMeme(OVER_THRESHOLD);
		const mod = {
			id: (await testUser({ role: 'moderator' })).id,
			username: 'm',
			displayName: null,
			role: 'moderator' as const
		};
		await resolveReports(mod, 'meme', inner(id), 'actioned');
		expect((await getFeedItem(mod.id, false, id))!.underReview).toBe(false);
	});

	it('a released meme (reviewedAt) stays visible however many new reports arrive', async () => {
		const { id, author } = await reportedMeme(OVER_THRESHOLD);
		const mod = {
			id: (await testUser({ role: 'moderator' })).id,
			username: 'm',
			displayName: null,
			role: 'moderator' as const
		};
		await resolveReports(mod, 'meme', inner(id), 'dismissed');
		await addOpenReports('meme', inner(id), author.id, OVER_THRESHOLD + 2);
		const viewer = await testUser();
		const item = (await getFeedItem(viewer.id, false, id))!;
		expect(item.underReview).toBe(false);
		expect(item.mediaUrl).not.toBeNull();
	});

	it('reports on comments/quotes or other memes do not affect a meme', async () => {
		const author = await testUser();
		const id = await addMedia(author.id);
		const other = await addMedia(author.id);
		await addOpenReports('meme', inner(other), author.id, OVER_THRESHOLD);
		await addOpenReports('comment', inner(id), author.id, OVER_THRESHOLD);
		const items = (await getFeedPage({ viewerId: author.id, sort: 'new' })).items;
		expect(items.find((i) => i.id === id)!.underReview).toBe(false);
		expect(items.find((i) => i.id === other)!.underReview).toBe(true);
	});

	it('a tag filter never matches hidden memes for members (no tag oracle); mods still find them', async () => {
		const { id } = await reportedMeme(OVER_THRESHOLD);
		const [{ id: tagId }] = await db.insert(tags).values({ name: 'geheim' }).returning();
		await db.insert(mediaTags).values({ mediaId: inner(id), tagId });
		const visible = await addMedia((await testUser()).id);
		await db.insert(mediaTags).values({ mediaId: inner(visible), tagId });
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
		await db.insert(mediaTags).values({ mediaId: inner(id), tagId });
		const mod = await testUser({ role: 'moderator' });
		await resolveReports(
			{ id: mod.id, username: mod.username, displayName: null, role: 'moderator' },
			'meme',
			inner(id),
			'dismissed'
		);
		const viewer = await testUser();
		const page = await getFeedPage({ viewerId: viewer.id, sort: 'new', tag: 'x' });
		expect(page.items.map((i) => i.id)).toEqual([id]);
	});
});
