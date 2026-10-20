import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { media, mediaViews } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { getDiscoverBatch } from './discover';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

let seq = 0;
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
		.returning({ id: media.id });
	return row.id;
}

describe('getDiscoverBatch', () => {
	it('returns unseen memes newest first with caughtUp false', async () => {
		const u = await testUser();
		const [a, b, c] = [await addMedia(u.id), await addMedia(u.id), await addMedia(u.id)];
		await db.insert(mediaViews).values({ userId: u.id, mediaId: a });
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

	it('replays seen memes once everything is seen', async () => {
		const u = await testUser();
		const ids = [await addMedia(u.id), await addMedia(u.id), await addMedia(u.id)];
		await db.insert(mediaViews).values(ids.map((mediaId) => ({ userId: u.id, mediaId })));
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
		await db.insert(mediaViews).values([hi, lo].map((mediaId) => ({ userId: u.id, mediaId })));
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
