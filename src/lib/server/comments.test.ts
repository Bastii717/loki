import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { comments, media, mediaViews, notifications } from './db/schema';
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
import { addOpenReports, OVER_THRESHOLD, timeOut } from './moderation-test-utils';
import { env } from './env';
import { resolveReports, TimeoutActiveError } from './moderation';
import { setPrefs } from './notifications';
import { isPublicId, publicIdOfMedia, resolveCommentId } from './public-ids';

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

/** Internal id of a comment item (items carry the public id; the delete and report APIs take the number). */
const cid = async (c: { id: string }) => (await resolveCommentId(c.id))!;

describe('comments', () => {
	it('adds trimmed comments and lists newest first with author data', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		const first = await addComment(u.id, id, '  erster  ');
		expect(first.text).toBe('erster');
		await addComment(u.id, id, 'zweiter');
		const list = await listComments(id);
		expect(list.map((c) => c.text)).toEqual(['zweiter', 'erster']);
		expect(list[0]).toMatchObject({ authorId: u.publicId, author: u.username });
	});

	it('exposes public ids only: id, mediaId and authorId, no internal id in the JSON', async () => {
		const u = await testUser();
		const id = await addMedia(u.id);
		const added = await addComment(u.id, id, 'hi');
		const [listed] = await listComments(id);
		for (const item of [added, listed]) {
			expect(isPublicId(item.id)).toBe(true);
			expect(item.mediaId).toBe(await publicIdOfMedia(id));
			expect(item.authorId).toBe(u.publicId);
			const json = JSON.stringify(item);
			expect(json).not.toMatch(new RegExp(`"id":${await cid(item)}[,}]`));
			expect(json).not.toMatch(new RegExp(`"mediaId":${id}[,}]`));
			expect(json).not.toMatch(new RegExp(`"authorId":${u.id}[,}]`));
		}
	});

	it('shows the display name when set, else the username, with role and avatar thumb', async () => {
		const named = await testUser({
			displayName: 'Ronja',
			displayNameKey: 'ronja',
			role: 'admin',
			avatarThumbKey: 'avatars/ronja-thumb.webp'
		});
		const plain = await testUser();
		const id = await addMedia(named.id);
		const added = await addComment(named.id, id, 'von Ronja');
		expect(added).toMatchObject({ author: 'Ronja', authorRole: 'admin' });
		await addComment(plain.id, id, 'von ohne');
		const list = await listComments(id);
		expect(list.find((c) => c.authorId === named.publicId)).toMatchObject({
			author: 'Ronja',
			authorRole: 'admin',
			authorAvatar: 'avatars/ronja-thumb.webp'
		});
		expect(list.find((c) => c.authorId === plain.publicId)).toMatchObject({
			author: plain.username,
			authorRole: 'member',
			authorAvatar: null
		});
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
		await deleteComment(
			{ id: u.id, username: u.username, displayName: null, role: 'member' },
			await cid(c)
		);
		expect(await db.select().from(comments)).toHaveLength(0);
	});

	it("forbids a member deleting someone else's comment", async () => {
		const a = await testUser();
		const b = await testUser();
		const id = await addMedia(a.id);
		const c = await addComment(a.id, id, 'meins');
		await expect(
			deleteComment(
				{ id: b.id, username: b.username, displayName: null, role: 'member' },
				await cid(c)
			)
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
		await deleteComment(
			{ id: mod.id, username: mod.username, displayName: null, role: 'moderator' },
			await cid(c1)
		);
		await deleteComment(
			{ id: admin.id, username: admin.username, displayName: null, role: 'admin' },
			await cid(c2)
		);
		expect(await db.select().from(comments)).toHaveLength(0);
	});

	it("refuses a timed-out moderator on someone else's comment, allows their own", async () => {
		const a = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const admin = await testUser({ role: 'admin' });
		const id = await addMedia(a.id);
		const foreign = await addComment(a.id, id, 'fremd');
		const own = await addComment(mod.id, id, 'eigen');
		await timeOut(mod.id, admin.id);
		const modUser = {
			id: mod.id,
			username: mod.username,
			displayName: null,
			role: 'moderator' as const
		};
		await expect(deleteComment(modUser, await cid(foreign))).rejects.toBeInstanceOf(
			TimeoutActiveError
		);
		await deleteComment(modUser, await cid(own));
		expect((await db.select().from(comments)).map((c) => c.publicId)).toEqual([foreign.id]);
	});

	it('throws CommentNotFoundError for a missing comment', async () => {
		const u = await testUser();
		await expect(
			deleteComment({ id: u.id, username: u.username, displayName: null, role: 'admin' }, 999999)
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

describe('listComments under review', () => {
	async function setup(reportCount: number) {
		const author = await testUser();
		const mid = await addMedia(author.id);
		const visible = await addComment(author.id, mid, 'harmlos');
		const reported = await addComment(author.id, mid, 'boese');
		await addOpenReports('comment', await cid(reported), author.id, reportCount);
		return { author, mid, visible, reported };
	}

	it('nulls only the over-threshold comment text for members', async () => {
		const { mid, visible, reported } = await setup(OVER_THRESHOLD);
		// listComments takes no viewer: the author sees the same as anyone else
		const list = await listComments(mid);
		expect(list.find((c) => c.id === visible.id)).toMatchObject({
			text: 'harmlos',
			underReview: false
		});
		expect(list.find((c) => c.id === reported.id)).toMatchObject({ text: null, underReview: true });
		expect(JSON.stringify(list)).not.toContain('boese');
	});

	it('moderators (revealAll) get the text, still flagged', async () => {
		const { mid, reported } = await setup(OVER_THRESHOLD);
		const list = await listComments(mid, true);
		expect(list.find((c) => c.id === reported.id)).toMatchObject({
			text: 'boese',
			underReview: true
		});
	});

	it('exactly at the threshold the text is visible', async () => {
		const { mid, reported } = await setup(env.REPORT_REVIEW_THRESHOLD);
		const list = await listComments(mid);
		expect(list.find((c) => c.id === reported.id)).toMatchObject({
			text: 'boese',
			underReview: false
		});
	});

	it('a released comment stays visible', async () => {
		const { mid, reported, author } = await setup(OVER_THRESHOLD);
		const mod = await testUser({ role: 'moderator' });
		await resolveReports(
			{ id: mod.id, username: mod.username, displayName: null, role: 'moderator' },
			'comment',
			await cid(reported),
			'dismissed'
		);
		await addOpenReports('comment', await cid(reported), author.id, OVER_THRESHOLD);
		const list = await listComments(mid);
		expect(list.find((c) => c.id === reported.id)).toMatchObject({
			text: 'boese',
			underReview: false
		});
	});
});

describe('addComment notices', () => {
	const noticesOf = (userId: number) =>
		db
			.select()
			.from(notifications)
			.where(eq(notifications.userId, userId))
			.orderBy(notifications.id);

	it('notifies the uploader with the excerpt, the meme and the commenter', async () => {
		const owner = await testUser();
		const lena = await testUser();
		const id = await addMedia(owner.id);
		const added = await addComment(lena.id, id, '  first\n\nline  ');
		expect(added.text).toBe('first\n\nline');
		const rows = await noticesOf(owner.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			kind: 'comment',
			actorId: lena.id,
			mediaId: id,
			detail: 'first line',
			count: 1,
			readAt: null
		});
		expect(await noticesOf(lena.id)).toHaveLength(0);
	});

	it('writes nothing when the uploader comments on their own meme', async () => {
		const owner = await testUser();
		const id = await addMedia(owner.id);
		await addComment(owner.id, id, 'talking to myself');
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	it('notifies earlier commenters once each, not the uploader and not the author', async () => {
		const owner = await testUser();
		const a = await testUser();
		const b = await testUser();
		const c = await testUser();
		const id = await addMedia(owner.id);
		await addComment(a.id, id, 'a1');
		await addComment(a.id, id, 'a2');
		await addComment(b.id, id, 'b1');
		await addComment(owner.id, id, 'owner reply');
		await db.delete(notifications);

		await addComment(c.id, id, 'newcomer');

		const forA = await noticesOf(a.id);
		const forB = await noticesOf(b.id);
		expect(forA).toHaveLength(1);
		expect(forB).toHaveLength(1);
		expect(forA[0]).toMatchObject({
			kind: 'thread_comment',
			actorId: c.id,
			mediaId: id,
			detail: 'newcomer'
		});
		expect(forB[0].kind).toBe('thread_comment');
		expect(await noticesOf(c.id)).toHaveLength(0);
		expect((await noticesOf(owner.id)).map((r) => r.kind)).toEqual(['comment']);
	});

	it('does not notify an earlier commenter about their own follow-up', async () => {
		const owner = await testUser();
		const a = await testUser();
		const id = await addMedia(owner.id);
		await addComment(a.id, id, 'one');
		await addComment(a.id, id, 'two');
		expect(await noticesOf(a.id)).toHaveLength(0);
	});

	it('folds a run of comments into one unread notice that counts up (3 own, then 2 by another)', async () => {
		const owner = await testUser();
		const lena = await testUser();
		const id = await addMedia(owner.id);
		for (const t of ['one', 'two', 'three']) await addComment(owner.id, id, t);
		await addComment(lena.id, id, 'hello');
		await addComment(lena.id, id, 'again');
		const rows = await noticesOf(owner.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			kind: 'comment',
			count: 2,
			actorId: lena.id,
			detail: 'again',
			readAt: null
		});
	});

	it('stops bumping and recreating once the recipient switched comments off', async () => {
		const owner = await testUser();
		const lena = await testUser();
		const id = await addMedia(owner.id);
		await addComment(lena.id, id, 'before');
		await setPrefs(owner.id, { comments: false, threadComments: true, reportOutcomes: true });
		await addComment(lena.id, id, 'after');
		const rows = await noticesOf(owner.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ count: 1, detail: 'before' });
	});

	it('leaves neither a comment nor a notice behind when the meme does not exist', async () => {
		const lena = await testUser();
		await expect(addComment(lena.id, 999999, 'hi')).rejects.toBeInstanceOf(MediaNotFoundError);
		expect(await db.select().from(notifications)).toHaveLength(0);
	});
});

describe('deleteComment report notices', () => {
	const noticesOf = (userId: number) =>
		db
			.select()
			.from(notifications)
			.where(eq(notifications.userId, userId))
			.orderBy(notifications.id);

	async function reportedComment() {
		const uploader = await testUser();
		const author = await testUser();
		const memeId = await addMedia(uploader.id);
		const [c] = await db
			.insert(comments)
			.values({ mediaId: memeId, authorId: author.id, text: 'reported text' })
			.returning({ id: comments.id });
		const [reporterId] = await addOpenReports('comment', c.id, author.id, 1);
		return { uploader, author, memeId, commentId: c.id, reporterId };
	}

	it('keeps the meme link in the reporter notice when a moderator deletes the comment', async () => {
		const { uploader, author, memeId, commentId, reporterId } = await reportedComment();
		const mod = await testUser({ role: 'moderator' });
		await db.delete(notifications);
		await deleteComment(
			{ id: mod.id, username: mod.username, displayName: null, role: 'moderator' },
			commentId
		);
		expect(await noticesOf(reporterId)).toMatchObject([
			{ kind: 'report_resolved', contentType: 'comment', mediaId: memeId, detail: 'actioned:x' }
		]);
		// the author hears of the deletion without a link; the uploader is not involved
		expect(await noticesOf(author.id)).toMatchObject([
			{ kind: 'content_deleted', contentType: 'comment', mediaId: null }
		]);
		expect(await noticesOf(uploader.id)).toHaveLength(0);
	});

	it('keeps the meme link when the author deletes their own reported comment', async () => {
		const { author, memeId, commentId, reporterId } = await reportedComment();
		await db.delete(notifications);
		await deleteComment(
			{ id: author.id, username: author.username, displayName: null, role: 'member' },
			commentId
		);
		expect(await noticesOf(reporterId)).toMatchObject([
			{ kind: 'report_resolved', mediaId: memeId, detail: 'removed:x' }
		]);
		expect(await noticesOf(author.id)).toHaveLength(0);
	});
});
