import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { media, mediaTags, tags } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { getStats } from './stats';
import { addOpenReports, OVER_THRESHOLD } from './moderation-test-utils';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const DAY = 24 * 60 * 60 * 1000;

async function addMedia(uploaderId: number, title: string, score = 0, ageDays = 0) {
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title,
			kind: 'image',
			objectKey: 'memes/o.webp',
			thumbKey: 'memes/t.webp',
			score,
			createdAt: new Date(Date.now() - ageDays * DAY)
		})
		.returning({ id: media.id });
	return row.id;
}

describe('getStats', () => {
	it('returns zero-filled 8 week buckets on an empty database', async () => {
		const s = await getStats();
		expect(s.uploadsPerWeek).toHaveLength(8);
		expect(s.uploadsPerWeek.every((w) => w.count === 0)).toBe(true);
		expect(s.uploadsPerWeek[0].week).toMatch(/^\d{4}-W\d{2}$/);
		expect(s.topUploaders).toEqual([]);
		expect(s.topVoted).toEqual([]);
		expect(s.topTags).toEqual([]);
	});

	it('buckets uploads by ISO week, oldest first, and ignores older ones', async () => {
		const u = await testUser();
		await addMedia(u.id, 'now-1');
		await addMedia(u.id, 'now-2');
		await addMedia(u.id, 'last-week', 0, 7);
		await addMedia(u.id, 'seven-weeks-ago', 0, 49);
		await addMedia(u.id, 'too-old', 0, 70);
		const s = await getStats();
		const counts = s.uploadsPerWeek.map((w) => w.count);
		expect(counts[7]).toBe(2);
		expect(counts[6]).toBe(1);
		expect(counts[0]).toBe(1);
		expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
		const labels = s.uploadsPerWeek.map((w) => w.week);
		expect(labels).toEqual([...labels].sort());
		expect(new Set(labels).size).toBe(8);
	});

	it('ranks top 5 uploaders, top 5 voted memes and top 5 tags', async () => {
		const users = [];
		for (let i = 0; i < 6; i++) users.push(await testUser());
		const ids: number[] = [];
		// user i uploads (6 - i) memes: counts 6,5,4,3,2,1
		for (let i = 0; i < 6; i++) {
			for (let j = 0; j < 6 - i; j++) {
				ids.push(await addMedia(users[i].id, `m${i}-${j}`, i * 10 + j));
			}
		}
		const s = await getStats();
		expect(s.topUploaders).toHaveLength(5);
		expect(s.topUploaders.map((x) => x.count)).toEqual([6, 5, 4, 3, 2]);
		expect(s.topUploaders[0].username).toBe(users[0].username);

		expect(s.topVoted).toHaveLength(5);
		const scores = s.topVoted.map((x) => x.score);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
		expect(s.topVoted[0]).toMatchObject({ title: 'm5-0', score: 50 });
		const topId = ids[ids.length - 1];
		const [top] = await db
			.select({ publicId: media.publicId })
			.from(media)
			.where(eq(media.id, topId));
		expect(s.topVoted[0].id).toBe(top.publicId);
		expect(JSON.stringify(s.topVoted)).not.toMatch(new RegExp(`"id":${topId}[,}]`));

		const tagRows = await db
			.insert(tags)
			.values(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name })))
			.returning();
		// tag k is attached to (6 - k) memes
		for (let k = 0; k < 6; k++) {
			for (let j = 0; j < 6 - k; j++) {
				await db.insert(mediaTags).values({ mediaId: ids[j], tagId: tagRows[k].id });
			}
		}
		const t = await getStats();
		expect(t.topTags).toEqual([
			{ name: 'a', count: 6 },
			{ name: 'b', count: 5 },
			{ name: 'c', count: 4 },
			{ name: 'd', count: 3 },
			{ name: 'e', count: 2 }
		]);
	});

	it('ranks uploaders by display name when set, else username', async () => {
		const named = await testUser({ displayName: 'Ronja', displayNameKey: 'ronja' });
		const plain = await testUser();
		await addMedia(named.id, 'a');
		await addMedia(named.id, 'b');
		await addMedia(plain.id, 'c');
		const s = await getStats();
		expect(s.topUploaders).toEqual([
			{ username: 'Ronja', count: 2 },
			{ username: plain.username, count: 1 }
		]);
	});

	it('leaves memes under review out of the top-voted list', async () => {
		const u = await testUser();
		await addMedia(u.id, 'harmlos', 5);
		const hidden = await addMedia(u.id, 'gemeldet', 99);
		await addOpenReports('meme', hidden, u.id, OVER_THRESHOLD);
		const s = await getStats();
		expect(s.topVoted.map((x) => x.title)).toEqual(['harmlos']);
	});
});
