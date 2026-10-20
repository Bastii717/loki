import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { media, votes } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { applyVote, MediaNotFoundError } from './votes';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

async function addMedia(uploaderId: number): Promise<number> {
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title: 'm',
			kind: 'image',
			objectKey: 'memes/o.webp',
			thumbKey: 'memes/t.webp'
		})
		.returning({ id: media.id });
	return row.id;
}

async function derivedScore(mediaId: number): Promise<number> {
	const [r] = await db
		.select({ s: sql<number>`coalesce(sum(${votes.value}), 0)::int` })
		.from(votes)
		.where(eq(votes.mediaId, mediaId));
	return r.s;
}

async function cachedScore(mediaId: number): Promise<number> {
	const [r] = await db.select({ s: media.score }).from(media).where(eq(media.id, mediaId));
	return r.s;
}

describe('applyVote', () => {
	it('keeps returned, derived and cached score identical: up, up again (0), down', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		const steps: [1 | -1 | 0, number][] = [
			[1, 1],
			[0, 0],
			[-1, -1]
		];
		for (const [value, expected] of steps) {
			const res = await applyVote(u.id, id, value);
			expect(res).toEqual({ score: expected, userVote: value });
			expect(await derivedScore(id)).toBe(res.score);
			expect(await cachedScore(id)).toBe(res.score);
		}
	});

	it('switches directly from up to down (delta -2) and removes the row on 0', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		await applyVote(u.id, id, 1);
		expect((await applyVote(u.id, id, -1)).score).toBe(-1);
		expect(await applyVote(u.id, id, 0)).toEqual({ score: 0, userVote: 0 });
		expect(await db.select().from(votes).where(eq(votes.mediaId, id))).toHaveLength(0);
	});

	it('is idempotent when repeating the same value', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		await applyVote(u.id, id, 1);
		expect((await applyVote(u.id, id, 1)).score).toBe(1);
		await applyVote(u.id, id, 0);
		expect(await applyVote(u.id, id, 0)).toEqual({ score: 0, userVote: 0 });
	});

	it('sums votes from different users', async () => {
		const a = await testUser();
		const b = await testUser();
		const id = await addMedia(a.id);
		await applyVote(a.id, id, 1);
		const res = await applyVote(b.id, id, 1);
		expect(res).toEqual({ score: 2, userVote: 1 });
		expect(await cachedScore(id)).toBe(2);
	});

	it('stays consistent under truly concurrent votes', async () => {
		const users = await Promise.all([testUser(), testUser(), testUser(), testUser()]);
		const id = await addMedia(users[0].id);
		await Promise.all(users.map((u) => applyVote(u.id, id, 1)));
		await Promise.all(users.map((u) => applyVote(u.id, id, -1)));
		expect(await derivedScore(id)).toBe(-4);
		expect(await cachedScore(id)).toBe(-4);
	});

	it('throws MediaNotFoundError for missing media', async () => {
		const u = await testUser();
		await expect(applyVote(u.id, 999999, 1)).rejects.toBeInstanceOf(MediaNotFoundError);
	});
});
