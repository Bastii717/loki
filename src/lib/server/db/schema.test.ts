import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './index';
import { comments, media, mediaTags, tags, votes } from './schema';
import { resetDb, setupDb, testUser } from './test-utils';

async function testMedia(uploaderId: number) {
	const [row] = await db
		.insert(media)
		.values({ uploaderId, kind: 'image', objectKey: 'o/1', thumbKey: 't/1' })
		.returning();
	return row;
}

describe('schema', () => {
	beforeAll(setupDb);
	beforeEach(resetDb);

	it('inserts user -> media -> vote with defaults', async () => {
		const user = await testUser();
		const m = await testMedia(user.id);
		expect(m).toMatchObject({
			title: '',
			nsfw: false,
			spoiler: false,
			score: 0,
			viewCount: 0,
			hotScore: 0
		});
		const [v] = await db
			.insert(votes)
			.values({ userId: user.id, mediaId: m.id, value: 1 })
			.returning();
		expect(v.value).toBe(1);
	});

	it('rejects a second vote for the same (user, media)', async () => {
		const user = await testUser();
		const m = await testMedia(user.id);
		await db.insert(votes).values({ userId: user.id, mediaId: m.id, value: 1 });
		await expect(
			db.insert(votes).values({ userId: user.id, mediaId: m.id, value: -1 })
		).rejects.toThrow();
	});

	it('cascades media deletion to votes, comments and mediaTags', async () => {
		const user = await testUser();
		const m = await testMedia(user.id);
		const [tag] = await db.insert(tags).values({ name: 'funny' }).returning();
		await db.insert(votes).values({ userId: user.id, mediaId: m.id, value: 1 });
		await db.insert(comments).values({ mediaId: m.id, authorId: user.id, text: 'lol' });
		await db.insert(mediaTags).values({ mediaId: m.id, tagId: tag.id });

		await db.delete(media).where(eq(media.id, m.id));

		expect(await db.select().from(votes)).toHaveLength(0);
		expect(await db.select().from(comments)).toHaveLength(0);
		expect(await db.select().from(mediaTags)).toHaveLength(0);
		expect(await db.select().from(tags)).toHaveLength(1);
	});
});
