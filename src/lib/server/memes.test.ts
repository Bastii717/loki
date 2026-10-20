import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CreateBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from './db';
import { comments, favorites, media, votes } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { env } from './env';
import { getFeedPage } from './feed';
import { deleteMedia, MediaPermissionError, setFlags, toggleFavorite } from './memes';
import { mediaKey, putObject, s3Client } from './storage';
import { MediaNotFoundError } from './votes';

beforeAll(async () => {
	await setupDb();
	try {
		await s3Client().send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
	} catch (e) {
		if ((e as Error).name !== 'BucketAlreadyOwnedByYou') throw e;
	}
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
		const objectKey = mediaKey(uploaderId, 'png');
		const thumbKey = mediaKey(uploaderId, 'webp');
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
		expect(byB.items.map((i) => i.id)).toEqual([b2.id, b1.id]);

		const favs = await getFeedPage({ viewerId: b.id, sort: 'new', filter: { favoriteOf: a.id } });
		expect(favs.items.map((i) => i.id)).toEqual([b1.id]);
		// viewer-specific state still refers to the viewer, not the filtered user
		expect(favs.items[0].userFavorite).toBe(false);
	});
});
