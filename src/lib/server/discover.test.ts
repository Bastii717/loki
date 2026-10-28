import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { media, mediaViews } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { getDiscoverBatch } from './discover';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

let seq = 0;
const internal = new Map<string, number>();

/** Inserts a meme and returns its public id (the internal id is kept for FK inserts). */
async function addMedia(uploaderId: number, over: Partial<typeof media.$inferInsert> = {}) {
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
			createdAt: new Date(Date.now() - 100_000 + seq * 1000),
			...over
		})
		.returning({ id: media.id, publicId: media.publicId });
	internal.set(row.publicId, row.id);
	return row.publicId;
}

describe('getDiscoverBatch', () => {
	it('returns unseen memes newest first with caughtUp false', async () => {
		const u = await testUser();
		const [a, b, c] = [await addMedia(u.id), await addMedia(u.id), await addMedia(u.id)];
		await db.insert(mediaViews).values({ userId: u.id, mediaId: internal.get(a)! });
		const r = await getDiscoverBatch(u.id);
		expect(r.caughtUp).toBe(false);
		expect(r.items.map((i) => i.id)).toEqual([c, b]);
	});

	it('skips excluded ids', async () => {
		const u = await testUser();
		const [a, b] = [await addMedia(u.id), await addMedia(u.id)];
		const r = await getDiscoverBatch(u.id, 10, [b]);
		expect(r.items.map((i) => i.id)).toEqual([a]);
	});

	it('ignores excluded entries that are not public ids', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		const r = await getDiscoverBatch(u.id, 10, [String(internal.get(a)), "x'; --"]);
		expect(r.items.map((i) => i.id)).toEqual([a]);
	});

	it('serves public ids only', async () => {
		const u = await testUser();
		const a = await addMedia(u.id);
		const r = await getDiscoverBatch(u.id);
		expect(r.items[0]).toMatchObject({ id: a, uploaderId: u.publicId });
		expect(JSON.stringify(r)).not.toMatch(new RegExp(`"id":${internal.get(a)}[,}]`));
	});

	it('replays seen memes once everything is seen', async () => {
		const u = await testUser();
		const ids = [await addMedia(u.id), await addMedia(u.id), await addMedia(u.id)];
		await db
			.insert(mediaViews)
			.values(ids.map((pid) => ({ userId: u.id, mediaId: internal.get(pid)! })));
		const r = await getDiscoverBatch(u.id);
		expect(r.caughtUp).toBe(true);
		expect(r.items.map((i) => i.id).sort()).toEqual([...ids].sort());
		const r2 = await getDiscoverBatch(u.id, 10, [ids[0]]);
		expect(r2.items.map((i) => i.id)).not.toContain(ids[0]);
	});

	it('weights replay by score', async () => {
		const u = await testUser();
		const hi = await addMedia(u.id, { score: 200 });
		const lo = await addMedia(u.id, { score: 0 });
		await db
			.insert(mediaViews)
			.values([hi, lo].map((pid) => ({ userId: u.id, mediaId: internal.get(pid)! })));
		let hiFirst = 0;
		for (let i = 0; i < 40; i++) {
			const r = await getDiscoverBatch(u.id, 1);
			if (r.items[0].id === hi) hiFirst++;
		}
		expect(hiFirst).toBeGreaterThan(30);
	});

	it('is empty and caughtUp when there are no memes', async () => {
		const u = await testUser();
		expect(await getDiscoverBatch(u.id)).toEqual({ items: [], caughtUp: true });
	});
});
