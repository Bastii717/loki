import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { comments, media, mediaViews } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import {
	addComment,
	CommentNotFoundError,
	CommentPermissionError,
	CommentTextError,
	deleteComment,
	listComments,
	markSeen
} from './comments';
import { MediaNotFoundError } from './votes';

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

describe('comments', () => {
	it('adds trimmed comments and lists newest first with author data', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		const first = await addComment(u.id, id, '  erster  ');
		expect(first.text).toBe('erster');
		await addComment(u.id, id, 'zweiter');
		const list = await listComments(id);
		expect(list.map((c) => c.text)).toEqual(['zweiter', 'erster']);
		expect(list[0]).toMatchObject({ authorId: u.id, author: u.username });
	});

	it('rejects empty and over-long text', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		await expect(addComment(u.id, id, '   ')).rejects.toBeInstanceOf(CommentTextError);
		await expect(addComment(u.id, id, 'x'.repeat(2001))).rejects.toBeInstanceOf(CommentTextError);
		await expect(addComment(u.id, id, 'x'.repeat(2000))).resolves.toBeTruthy();
	});

	it('throws MediaNotFoundError for a missing meme', async () => {
		const u = await testUser();
		await expect(addComment(u.id, 999999, 'hi')).rejects.toBeInstanceOf(MediaNotFoundError);
	});

	it('lets the author delete their own comment', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		const c = await addComment(u.id, id, 'weg');
		await deleteComment({ id: u.id, username: u.username, role: 'member' }, c.id);
		expect(await db.select().from(comments)).toHaveLength(0);
	});

	it("forbids a member deleting someone else's comment", async () => {
		const a = await testUser();
		const b = await testUser();
		const id = await addMedia(a.id);
		const c = await addComment(a.id, id, 'meins');
		await expect(
			deleteComment({ id: b.id, username: b.username, role: 'member' }, c.id)
		).rejects.toBeInstanceOf(CommentPermissionError);
		expect(await db.select().from(comments)).toHaveLength(1);
	});

	it("lets moderators and admins delete someone else's comment", async () => {
		const a = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const admin = await testUser({ role: 'admin' });
		const id = await addMedia(a.id);
		const c1 = await addComment(a.id, id, 'eins');
		const c2 = await addComment(a.id, id, 'zwei');
		await deleteComment({ id: mod.id, username: mod.username, role: 'moderator' }, c1.id);
		await deleteComment({ id: admin.id, username: admin.username, role: 'admin' }, c2.id);
		expect(await db.select().from(comments)).toHaveLength(0);
	});

	it('throws CommentNotFoundError for a missing comment', async () => {
		const u = await testUser();
		await expect(
			deleteComment({ id: u.id, username: u.username, role: 'admin' }, 999999)
		).rejects.toBeInstanceOf(CommentNotFoundError);
	});
});

describe('markSeen', () => {
	it('is idempotent: one mediaViews row and viewCount 1 after two calls', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		await markSeen(u.id, id);
		await markSeen(u.id, id);
		expect(await db.select().from(mediaViews).where(eq(mediaViews.mediaId, id))).toHaveLength(1);
		const [m] = await db.select({ v: media.viewCount }).from(media).where(eq(media.id, id));
		expect(m.v).toBe(1);
	});

	it('reports whether the call counted a new view', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		expect(await markSeen(u.id, id)).toBe(true);
		expect(await markSeen(u.id, id)).toBe(false);
	});

	it('counts each distinct user once, also under concurrency', async () => {
		const users = await Promise.all([testUser(), testUser(), testUser()]);
		const id = await addMedia(users[0].id);
		await Promise.all([...users, ...users].map((u) => markSeen(u.id, id)));
		const [m] = await db.select({ v: media.viewCount }).from(media).where(eq(media.id, id));
		expect(m.v).toBe(3);
	});

	it('throws MediaNotFoundError for a missing meme', async () => {
		const u = await testUser();
		await expect(markSeen(u.id, 999999)).rejects.toBeInstanceOf(MediaNotFoundError);
	});
});
