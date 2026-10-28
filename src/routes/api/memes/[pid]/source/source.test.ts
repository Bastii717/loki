import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../../../lib/server/db';
import { media } from '../../../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertMemeRow,
	OVER_THRESHOLD,
	userWithSession
} from '../../../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../../../lib/server/rate-limit';
import { deleteObjects, putObject } from '../../../../../lib/server/storage';
import { ensureBucket } from '../../../../../lib/server/storage-test-utils';
import { callRoute } from '../../../../../lib/server/test-request';
import { GET } from './+server';

const created: string[] = [];
let jpeg: Buffer;

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f80' } })
		.jpeg()
		.toBuffer();
});

beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

afterAll(async () => {
	if (created.length) await deleteObjects(created);
});

/** A meme whose original object really exists in the bucket. */
async function memeWithObject(uploaderId: number, kind: 'image' | 'gif' | 'video' = 'image') {
	const { id, publicId } = await insertMemeRow(uploaderId);
	const [row] = await db.select().from(media).where(eq(media.id, id));
	await putObject(row.objectKey, jpeg, 'image/jpeg');
	created.push(row.objectKey);
	if (kind !== 'image') await db.update(media).set({ kind }).where(eq(media.id, id));
	return { id, pid: publicId };
}

const get = (pid: string, session?: string) =>
	callRoute({ handler: GET, path: `/api/memes/${pid}/source`, params: { pid }, session });

describe('GET /api/memes/[pid]/source', () => {
	it('streams the original object of an image meme with its content type', async () => {
		const author = await userWithSession();
		const viewer = await userWithSession();
		const { pid } = await memeWithObject(author.user.id);
		const { response } = await get(pid, viewer.session);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(Buffer.from(await response.arrayBuffer()).equals(jpeg)).toBe(true);
	});

	it.each(['gif', 'video'] as const)('answers 404 for a %s meme', async (kind) => {
		const author = await userWithSession();
		const { pid } = await memeWithObject(author.user.id, kind);
		const { response } = await get(pid, author.session);
		expect(response.status).toBe(404);
	});

	it('answers 404 for an unknown public id', async () => {
		const viewer = await userWithSession();
		expect((await get('AAAAAAAAAAAA', viewer.session)).response.status).toBe(404);
	});

	it.each(['1', '0', '-3', 'x', '1.2', 'AAAAAAAAAAA', 'AAAAAAAAAAAAA'])(
		'answers 404 for the id %s',
		async (pid) => {
			const viewer = await userWithSession();
			expect((await get(pid, viewer.session)).response.status).toBe(404);
		}
	);

	it('answers 404 for the numeric internal id of a real image meme', async () => {
		const author = await userWithSession();
		const { id } = await memeWithObject(author.user.id);
		expect((await get(String(id), author.session)).response.status).toBe(404);
	});

	it('answers 401 JSON for an anonymous request', async () => {
		const author = await userWithSession();
		const { pid } = await memeWithObject(author.user.id);
		const { response } = await get(pid);
		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toContain('application/json');
	});

	describe('a meme hidden for review', () => {
		it('is 404 for members and for the author, 200 for moderators and admins', async () => {
			const author = await userWithSession();
			const member = await userWithSession();
			const mod = await userWithSession('moderator');
			const admin = await userWithSession('admin');
			const { id, pid } = await memeWithObject(author.user.id);
			await addOpenReports('meme', id, author.user.id, OVER_THRESHOLD);

			expect((await get(pid, member.session)).response.status).toBe(404);
			expect((await get(pid, author.session)).response.status).toBe(404);
			expect((await get(pid, mod.session)).response.status).toBe(200);
			expect((await get(pid, admin.session)).response.status).toBe(200);
		});

		it('is served to members again once a moderator released it', async () => {
			const author = await userWithSession();
			const member = await userWithSession();
			const { id, pid } = await memeWithObject(author.user.id);
			await addOpenReports('meme', id, author.user.id, OVER_THRESHOLD);
			await db.update(media).set({ reviewedAt: new Date() }).where(eq(media.id, id));
			expect((await get(pid, member.session)).response.status).toBe(200);
		});
	});
});
