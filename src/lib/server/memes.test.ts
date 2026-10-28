import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from './db';
import { comments, favorites, media, notifications, votes } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { env } from './env';
import { getFeedPage } from './feed';
import { deleteMedia, MediaPermissionError, setFlags, toggleFavorite } from './memes';
import { TimeoutActiveError } from './moderation';
import { addOpenReports, timeOut } from './moderation-test-utils';
import { mediaKey, putObject, s3Client } from './storage';
import { ensureBucket } from './storage-test-utils';
import { MediaNotFoundError } from './votes';

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
});
beforeEach(resetDb);
afterAll(resetDb);

async function addMedia(uploaderId: number, over: Partial<typeof media.$inferInsert> = {}) {
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title: 'm',
			kind: 'image',
			objectKey: 'memes/o.webp',
			thumbKey: 'memes/t.webp',
			...over
		})
		.returning();
	return row;
}

async function exists(key: string): Promise<boolean> {
	try {
		await s3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
		return true;
	} catch (e) {
		if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
			return false;
		throw e;
	}
}

describe('toggleFavorite', () => {
	it('toggles on and off and counts across users', async () => {
		const a = await testUser();
		const b = await testUser();
		const m = await addMedia(a.id);
		expect(await toggleFavorite(a.id, m.id)).toEqual({ favorited: true, count: 1 });
		expect(await toggleFavorite(b.id, m.id)).toEqual({ favorited: true, count: 2 });
		expect(await toggleFavorite(a.id, m.id)).toEqual({ favorited: false, count: 1 });
		expect(await db.select().from(favorites).where(eq(favorites.mediaId, m.id))).toHaveLength(1);
	});

	it('throws MediaNotFoundError for missing media', async () => {
		const u = await testUser();
		await expect(toggleFavorite(u.id, 999999)).rejects.toBeInstanceOf(MediaNotFoundError);
	});
});

describe('deleteMedia', () => {
	async function stored(uploaderId: number) {
		const objectKey = mediaKey('png');
		const thumbKey = mediaKey('webp');
		await putObject(objectKey, Buffer.from('o'), 'image/png');
		await putObject(thumbKey, Buffer.from('t'), 'image/webp');
		return addMedia(uploaderId, { objectKey, thumbKey });
	}

	it('refuses a member deleting a foreign meme and changes nothing', async () => {
		const owner = await testUser();
		const other = await testUser();
		const m = await stored(owner.id);
		await expect(deleteMedia(other, m.id)).rejects.toBeInstanceOf(MediaPermissionError);
		expect(await db.select().from(media).where(eq(media.id, m.id))).toHaveLength(1);
		expect(await exists(m.objectKey)).toBe(true);
		expect(await exists(m.thumbKey)).toBe(true);
		await deleteMedia(owner, m.id); // clean up the bucket
	});

	it('lets the uploader delete: row, dependents and both objects are gone', async () => {
		const owner = await testUser();
		const fan = await testUser();
		const m = await stored(owner.id);
		await toggleFavorite(fan.id, m.id);
		await db.insert(votes).values({ userId: fan.id, mediaId: m.id, value: 1 });
		await db.insert(comments).values({ mediaId: m.id, authorId: fan.id, text: 'x' });
		await deleteMedia(owner, m.id);
		expect(await db.select().from(media).where(eq(media.id, m.id))).toHaveLength(0);
		expect(await db.select().from(favorites)).toHaveLength(0);
		expect(await db.select().from(votes)).toHaveLength(0);
		expect(await db.select().from(comments)).toHaveLength(0);
		expect(await exists(m.objectKey)).toBe(false);
		expect(await exists(m.thumbKey)).toBe(false);
	});

	it('lets a moderator delete a foreign meme including bucket objects', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await stored(owner.id);
		await deleteMedia(mod, m.id);
		expect(await db.select().from(media).where(eq(media.id, m.id))).toHaveLength(0);
		expect(await exists(m.objectKey)).toBe(false);
		expect(await exists(m.thumbKey)).toBe(false);
	});

	it('throws MediaNotFoundError for missing media', async () => {
		const admin = await testUser({ role: 'admin' });
		await expect(deleteMedia(admin, 999999)).rejects.toBeInstanceOf(MediaNotFoundError);
	});
});

describe('setFlags', () => {
	it('refuses a member on foreign media', async () => {
		const owner = await testUser();
		const other = await testUser();
		const m = await addMedia(owner.id);
		await expect(setFlags(other, m.id, { nsfw: true })).rejects.toBeInstanceOf(
			MediaPermissionError
		);
		const [row] = await db.select().from(media).where(eq(media.id, m.id));
		expect(row.nsfw).toBe(false);
	});

	it('lets the uploader and moderators set flags, leaving unspecified ones alone', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await addMedia(owner.id, { spoiler: true });
		await setFlags(owner, m.id, { nsfw: true });
		let [row] = await db.select().from(media).where(eq(media.id, m.id));
		expect([row.nsfw, row.spoiler]).toEqual([true, true]);
		await setFlags(mod, m.id, { spoiler: false });
		[row] = await db.select().from(media).where(eq(media.id, m.id));
		expect([row.nsfw, row.spoiler]).toEqual([true, false]);
	});

	it('throws MediaNotFoundError for missing media', async () => {
		const mod = await testUser({ role: 'moderator' });
		await expect(setFlags(mod, 999999, { nsfw: true })).rejects.toBeInstanceOf(MediaNotFoundError);
	});

	it('refuses a timed-out moderator on foreign media (moderation rights are suspended)', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const admin = await testUser({ role: 'admin' });
		const m = await addMedia(owner.id);
		await timeOut(mod.id, admin.id);
		await expect(setFlags(mod, m.id, { nsfw: true })).rejects.toBeInstanceOf(TimeoutActiveError);
		const [row] = await db.select().from(media).where(eq(media.id, m.id));
		expect(row.nsfw).toBe(false);
	});
});

describe('notices', () => {
	const noticesOf = (userId: number) =>
		db
			.select()
			.from(notifications)
			.where(eq(notifications.userId, userId))
			.orderBy(notifications.id);

	it('a moderator forcing the NSFW blur tells the uploader, and closes reports as actioned', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await addMedia(owner.id, { title: 'Titel' });
		const [reporter] = await addOpenReports('meme', m.id, owner.id, 1);
		await setFlags(mod, m.id, { nsfw: true });
		const [notice] = await noticesOf(owner.id);
		expect(notice).toMatchObject({
			kind: 'content_flagged',
			actorId: null,
			contentType: 'meme',
			contentId: m.id,
			mediaId: m.id,
			detail: 'nsfw:Titel'
		});
		expect(await noticesOf(owner.id)).toHaveLength(1);
		const [outcome] = await noticesOf(reporter);
		expect(outcome).toMatchObject({ kind: 'report_resolved', detail: 'actioned:x' });
	});

	it('names both flags when both are switched on', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await addMedia(owner.id, { title: 'Titel' });
		await setFlags(mod, m.id, { nsfw: true, spoiler: true });
		const [notice] = await noticesOf(owner.id);
		expect(notice.detail).toBe('nsfw,spoiler:Titel');
	});

	it('names only the flags this call switched on', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await addMedia(owner.id, { title: 'Titel', nsfw: true });
		await setFlags(mod, m.id, { nsfw: true, spoiler: true });
		const [notice] = await noticesOf(owner.id);
		expect(notice.detail).toBe('spoiler:Titel');
	});

	it('writes nothing when the flag was on already', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await addMedia(owner.id, { nsfw: true });
		await setFlags(mod, m.id, { nsfw: true });
		expect(await noticesOf(owner.id)).toHaveLength(0);
	});

	it('writes nothing when a moderator only switches a flag off', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await addMedia(owner.id, { nsfw: true });
		await setFlags(mod, m.id, { nsfw: false });
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	it('writes nothing for the uploader flagging their own meme', async () => {
		const owner = await testUser();
		const m = await addMedia(owner.id);
		await setFlags(owner, m.id, { nsfw: true, spoiler: true });
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	it('the uploader deleting a reported meme tells the reporters "removed" without a meme link', async () => {
		const owner = await testUser();
		const m = await addMedia(owner.id);
		const reporters = await addOpenReports('meme', m.id, owner.id, 2);
		await deleteMedia(owner, m.id);
		for (const r of reporters) {
			const rows = await noticesOf(r);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				kind: 'report_resolved',
				contentType: 'meme',
				contentId: m.id,
				mediaId: null,
				detail: 'removed:x'
			});
		}
		expect(await noticesOf(owner.id)).toHaveLength(0);
	});

	it('a moderator deleting a meme with reported comments tells comment reporters "removed", meme reporters "actioned" and the uploader once', async () => {
		const owner = await testUser();
		const commenter = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const m = await addMedia(owner.id, { title: 'Titel' });
		const [c] = await db
			.insert(comments)
			.values({ mediaId: m.id, authorId: commenter.id, text: 'hi' })
			.returning({ id: comments.id });
		const [commentReporter] = await addOpenReports('comment', c.id, commenter.id, 1);
		const [memeReporter] = await addOpenReports('meme', m.id, owner.id, 1);
		await deleteMedia(mod, m.id);

		const forCommentReporter = await noticesOf(commentReporter);
		expect(forCommentReporter).toHaveLength(1);
		expect(forCommentReporter[0]).toMatchObject({
			kind: 'report_resolved',
			contentType: 'comment',
			contentId: c.id,
			mediaId: null,
			detail: 'removed:x'
		});
		const forMemeReporter = await noticesOf(memeReporter);
		expect(forMemeReporter).toHaveLength(1);
		expect(forMemeReporter[0]).toMatchObject({
			kind: 'report_resolved',
			contentType: 'meme',
			mediaId: null,
			detail: 'actioned:x'
		});
		const forOwner = await noticesOf(owner.id);
		expect(forOwner).toHaveLength(1);
		expect(forOwner[0]).toMatchObject({
			kind: 'content_deleted',
			contentType: 'meme',
			mediaId: null,
			detail: 'Titel'
		});
		// the commenter's comment was collateral damage, not a moderation decision on them
		expect(await noticesOf(commenter.id)).toHaveLength(0);
	});
});

describe('moderator deletes while timed out', () => {
	it('deleteMedia: refused on foreign media, still allowed on the own one', async () => {
		const owner = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const admin = await testUser({ role: 'admin' });
		const foreign = await addMedia(owner.id);
		const own = await addMedia(mod.id);
		await timeOut(mod.id, admin.id);
		await expect(deleteMedia(mod, foreign.id)).rejects.toBeInstanceOf(TimeoutActiveError);
		expect(await db.select().from(media).where(eq(media.id, foreign.id))).toHaveLength(1);
		await deleteMedia(mod, own.id);
		expect(await db.select().from(media).where(eq(media.id, own.id))).toHaveLength(0);
	});
});

describe('getFeedPage filter', () => {
	it('restricts to an uploader or to a user favorites', async () => {
		const a = await testUser();
		const b = await testUser();
		const a1 = await addMedia(a.id);
		const b1 = await addMedia(b.id);
		const b2 = await addMedia(b.id);
		await toggleFavorite(a.id, b1.id);
		await toggleFavorite(b.id, a1.id);

		const byB = await getFeedPage({ viewerId: a.id, sort: 'new', filter: { uploaderId: b.id } });
		expect(byB.items.map((i) => i.id)).toEqual([b2.publicId, b1.publicId]);

		const favs = await getFeedPage({ viewerId: b.id, sort: 'new', filter: { favoriteOf: a.id } });
		expect(favs.items.map((i) => i.id)).toEqual([b1.publicId]);
		// viewer-specific state still refers to the viewer, not the filtered user
		expect(favs.items[0].userFavorite).toBe(false);
	});
});
