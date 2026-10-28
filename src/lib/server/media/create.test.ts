import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { media, mediaTags, tags, templates } from '../db/schema';
import { resetDb, setupDb, testUser } from '../db/test-utils';
import { env } from '../env';
import { deleteObjects, s3Client } from '../storage';
import { ensureBucket } from '../storage-test-utils';
import { UploadError, createMedia, normalizeTag } from './create';

async function listKeys(): Promise<string[]> {
	const out: string[] = [];
	let token: string | undefined;
	do {
		const res = await s3Client().send(
			new ListObjectsV2Command({
				Bucket: env.S3_BUCKET,
				Prefix: 'memes/',
				ContinuationToken: token
			})
		);
		out.push(...(res.Contents ?? []).map((o) => o.Key!));
		token = res.NextContinuationToken;
	} while (token);
	return out.sort();
}

const exists = (Key: string) =>
	s3Client()
		.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }))
		.then(
			() => true,
			() => false
		);

let png: Buffer;
const created: string[] = [];

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#39c' } })
		.png()
		.toBuffer();
});

beforeEach(resetDb);

afterAll(async () => {
	if (created.length) await deleteObjects(created);
});

const asUploader = (u: {
	id: number;
	username: string;
	role: 'member' | 'moderator' | 'admin';
}) => ({
	id: u.id,
	username: u.username,
	displayName: null,
	role: u.role
});

describe('normalizeTag', () => {
	it('lowercases, trims and strips a leading #', () => {
		expect(normalizeTag('#Montag ')).toBe('montag');
		expect(normalizeTag('Größe-1')).toBe('größe-1');
	});
	it('rejects invalid tags', () => {
		expect(normalizeTag('x')).toBeNull();
		expect(normalizeTag('a b')).toBeNull();
		expect(normalizeTag('a'.repeat(31))).toBeNull();
		expect(normalizeTag('##x1')).toBeNull();
	});
});

describe('createMedia', () => {
	it('stores original and thumb, inserts media with deduplicated tags', async () => {
		const user = await testUser();
		const { id } = await createMedia({
			uploader: asUploader(user),
			file: png,
			title: 'Hallo',
			tagNames: ['#Montag', 'montag', 'x', 'kaffee'],
			nsfw: true,
			spoiler: false
		});
		const [row] = await db.select().from(media).where(eq(media.id, id));
		created.push(row.objectKey, row.thumbKey);
		expect(row).toMatchObject({
			uploaderId: user.id,
			title: 'Hallo',
			kind: 'image',
			width: 300,
			height: 200,
			nsfw: true,
			spoiler: false
		});
		expect(row.objectKey).toMatch(new RegExp(`^memes/u${user.id}/.+\\.png$`));
		expect(row.thumbKey).toMatch(/\.webp$/);
		expect(await exists(row.objectKey)).toBe(true);
		expect(await exists(row.thumbKey)).toBe(true);
		const rows = await db
			.select({ name: tags.name })
			.from(mediaTags)
			.innerJoin(tags, eq(tags.id, mediaTags.tagId))
			.where(eq(mediaTags.mediaId, id));
		expect(rows.map((r) => r.name).sort()).toEqual(['kaffee', 'montag']);
	});

	it('stores the template id, or null without one', async () => {
		const user = await testUser();
		const [tpl] = await db
			.insert(templates)
			.values({
				name: 'T',
				objectKey: 'templates/x.webp',
				thumbKey: 'templates/x-320.webp',
				width: 10,
				height: 10
			})
			.returning({ id: templates.id });
		const make = async (templateId?: number | null) => {
			const { id } = await createMedia({
				uploader: asUploader(user),
				file: png,
				title: 'T',
				tagNames: [],
				nsfw: false,
				spoiler: false,
				templateId
			});
			const [row] = await db.select().from(media).where(eq(media.id, id));
			created.push(row.objectKey, row.thumbKey);
			return row.templateId;
		};
		expect(await make(tpl.id)).toBe(tpl.id);
		expect(await make(null)).toBeNull();
		expect(await make()).toBeNull();
	});

	it('rejects a PDF with UploadError(type) and leaves the bucket untouched', async () => {
		const user = await testUser();
		const before = await listKeys();
		const err = await createMedia({
			uploader: asUploader(user),
			file: Buffer.from('%PDF-1.4\n%fake\n'),
			title: '',
			tagNames: [],
			nsfw: false,
			spoiler: false
		}).catch((e) => e);
		expect(err).toBeInstanceOf(UploadError);
		expect(err.code).toBe('type');
		expect(await listKeys()).toEqual(before);
	});

	it('rejects a body over MAX_UPLOAD_MB with UploadError(size)', async () => {
		const user = await testUser();
		const before = await listKeys();
		const big = Buffer.concat([png, Buffer.alloc(env.MAX_UPLOAD_MB * 1024 * 1024)]);
		const err = await createMedia({
			uploader: asUploader(user),
			file: big,
			title: '',
			tagNames: [],
			nsfw: false,
			spoiler: false
		}).catch((e) => e);
		expect(err).toBeInstanceOf(UploadError);
		expect(err.code).toBe('size');
		expect(await listKeys()).toEqual(before);
	});

	it('removes uploaded objects when the database insert fails', async () => {
		const before = await listKeys();
		await expect(
			createMedia({
				uploader: { id: 999999, username: 'ghost', displayName: null, role: 'member' }, // FK violation
				file: png,
				title: '',
				tagNames: [],
				nsfw: false,
				spoiler: false
			})
		).rejects.toThrow();
		expect(await listKeys()).toEqual(before);
	});
});
