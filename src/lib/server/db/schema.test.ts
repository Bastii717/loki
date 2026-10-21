import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './index';
import {
	auditLog,
	comments,
	media,
	mediaTags,
	quotes,
	reports,
	tags,
	timeouts,
	users,
	votes
} from './schema';
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

	it('keeps a report (with its excerpt) after the reported meme is deleted', async () => {
		const author = await testUser();
		const reporter = await testUser();
		const m = await testMedia(author.id);
		const [r] = await db
			.insert(reports)
			.values({
				contentType: 'meme',
				contentId: m.id,
				reporterId: reporter.id,
				authorId: author.id,
				category: 'spam',
				excerpt: 'my funny meme'
			})
			.returning();
		expect(r).toMatchObject({
			text: '',
			status: 'open',
			outcome: null,
			resolvedAt: null,
			resolvedBy: null
		});

		await db.delete(media).where(eq(media.id, m.id));

		const rows = await db.select().from(reports);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			contentId: m.id,
			excerpt: 'my funny meme',
			authorId: author.id
		});
	});

	it('inserts timeouts, cascades on user deletion and defaults lift columns to null', async () => {
		const target = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const [t] = await db
			.insert(timeouts)
			.values({
				userId: target.id,
				setBy: mod.id,
				reason: 'spam',
				until: new Date(Date.now() + 3600_000)
			})
			.returning();
		expect(t).toMatchObject({ liftedAt: null, liftedBy: null });
		expect(t.createdAt).toBeInstanceOf(Date);

		await db.delete(users).where(eq(users.id, target.id));
		expect(await db.select().from(timeouts)).toHaveLength(0);
	});

	it('appends audit log rows with a default empty detail', async () => {
		const mod = await testUser({ role: 'moderator' });
		const [a] = await db
			.insert(auditLog)
			.values({ actorId: mod.id, action: 'report.resolve', targetType: 'report', targetId: 1 })
			.returning();
		expect(a).toMatchObject({ actorId: mod.id, detail: '' });
		expect(a.createdAt).toBeInstanceOf(Date);
	});

	it('adds a nullable reviewedAt to media, comments and quotes', async () => {
		const user = await testUser();
		const m = await testMedia(user.id);
		const [c] = await db
			.insert(comments)
			.values({ mediaId: m.id, authorId: user.id, text: 'hi' })
			.returning();
		const [q] = await db.insert(quotes).values({ text: 'q', author: 'a' }).returning();
		expect([m.reviewedAt, c.reviewedAt, q.reviewedAt]).toEqual([null, null, null]);
	});
});
