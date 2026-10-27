import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../hooks.server';
import { createSession } from '../../lib/server/auth/session';
import { resetDb, setupDb, testUser } from '../../lib/server/db/test-utils';
import { env } from '../../lib/server/env';
import { deleteObjects, putObject } from '../../lib/server/storage';
import { ensureBucket } from '../../lib/server/storage-test-utils';
import * as moderation from '../../lib/server/moderation';
import { addOpenReports, OVER_THRESHOLD } from '../../lib/server/moderation-test-utils';
import { db } from '../../lib/server/db';
import { media } from '../../lib/server/db/schema';
import { GET } from './[...key]/+server';

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
});
beforeEach(resetDb);

const BYTES = 'MEDIA-BYTES-FIXTURE';
const KEY = `memes/utest/${crypto.randomUUID()}.txt`;
const s3Host = new URL(env.S3_ENDPOINT).host;

beforeAll(async () => {
	await putObject(KEY, Buffer.from(BYTES), 'text/plain');
	return () => deleteObjects([KEY]);
});

/** Runs a request through the real auth hook; the resolved route is the media GET handler. */
async function request(rawPath: string, cookie?: string) {
	const url = new URL(`https://loki.test${rawPath}`);
	// SvelteKit rest params arrive percent-decoded
	const key = decodeURIComponent(url.pathname.replace(/^\/media\/?/, ''));
	const event = {
		url,
		request: new Request(url),
		params: { key },
		cookies: {
			get: (name: string) => (name === 'loki_session' ? cookie : undefined),
			delete: () => {},
			set: () => {}
		},
		locals: {} as App.Locals
	} as unknown as RequestEvent;
	// SvelteKit turns a thrown HttpError into a response; mirror that here
	const resolve = (async (e: RequestEvent) => {
		try {
			return await GET(e as never);
		} catch (err) {
			if (isHttpError(err)) return new Response(err.body.message, { status: err.status });
			throw err;
		}
	}) as Parameters<Handle>[0]['resolve'];
	return Promise.resolve(handle({ event, resolve }));
}

describe('GET /media/[...key]', () => {
	it('leaks neither bytes nor the S3 host without a session', async () => {
		const res = await request(`/media/${KEY}`);
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/login');
		const body = await res.text();
		expect(body).not.toContain(BYTES);
		expect(body).not.toContain(s3Host);
		expect([...res.headers.values()].join('\n')).not.toContain(s3Host);
	});

	it('redirects to a presigned S3 URL with a session', async () => {
		const user = await testUser();
		const res = await request(`/media/${KEY}`, await createSession(user.id));
		expect(res.status).toBe(302);
		const location = new URL(res.headers.get('location')!);
		expect(location.host).toBe(s3Host);
		expect(location.pathname).toContain(KEY);
		expect(location.searchParams.get('X-Amz-Expires')).toBe('60');
		expect(res.headers.get('cache-control')).toBe('private, max-age=30');
		const object = await fetch(location);
		expect(await object.text()).toBe(BYTES);
	});

	it.each([
		'/media/memes/../secrets/x.jpg',
		'/media/../../etc',
		'/media/memes/%2e%2e/secrets/x.jpg',
		'/media/memes/%2E%2E%2Fsecrets/x.jpg',
		'/media/memes/%252e%252e/x.jpg',
		'/media/memes%2F..%2F..%2Fother/x.jpg',
		'/media/memes/u1/%5C..%5Cx.jpg',
		'/media/memes%2F.%2Fu1/x.jpg',
		'/media/memes//x.jpg',
		'/media/memes/u1/x%00.jpg',
		'/media/other/u1/x.jpg',
		'/media/xmemes/u1/x.jpg',
		'/media/memes'
	])('returns 404 for %s', async (path) => {
		const user = await testUser();
		const res = await request(path, await createSession(user.id));
		expect(res.status).toBe(404);
		expect(res.headers.get('location')).toBeNull();
	});

	describe('avatars', () => {
		const AVATAR = 'avatars/u1/abc-64.webp';

		it('redirects to a presigned S3 URL with a session, without the under-review lookup', async () => {
			const user = await testUser();
			const cookie = await createSession(user.id);
			const lookup = vi.spyOn(moderation, 'isMediaKeyUnderReview');
			let res: Response;
			try {
				res = await request(`/media/${AVATAR}`, cookie);
			} finally {
				const calls = lookup.mock.calls.length;
				lookup.mockRestore();
				expect(calls).toBe(0);
			}
			expect(res.status).toBe(302);
			const location = new URL(res.headers.get('location')!);
			expect(location.host).toBe(s3Host);
			expect(location.pathname).toContain(AVATAR);
		});

		it('requires a session', async () => {
			const res = await request(`/media/${AVATAR}`);
			expect(res.status).toBe(303);
			expect(res.headers.get('location')).toBe('/login');
		});

		it('rejects traversal out of avatars/', async () => {
			const user = await testUser();
			// the URL parser resolves literal and %2e ".." segments; an encoded slash reaches the route decoded
			const res = await request('/media/avatars%2F..%2Fmemes/x', await createSession(user.id));
			expect(res.status).toBe(404);
			expect(res.headers.get('location')).toBeNull();
		});

		it('rejects other prefixes', async () => {
			const user = await testUser();
			const res = await request('/media/other/x', await createSession(user.id));
			expect(res.status).toBe(404);
		});
	});

	describe('under review', () => {
		const OBJ = `memes/utest/${crypto.randomUUID()}-o.txt`;
		const THUMB = `memes/utest/${crypto.randomUUID()}-t.txt`;

		beforeAll(async () => {
			await putObject(OBJ, Buffer.from('o'), 'text/plain');
			await putObject(THUMB, Buffer.from('t'), 'text/plain');
			return () => deleteObjects([OBJ, THUMB]);
		});

		async function reportedMeme(reports: number) {
			const author = await testUser();
			const [row] = await db
				.insert(media)
				.values({ uploaderId: author.id, kind: 'image', objectKey: OBJ, thumbKey: THUMB })
				.returning({ id: media.id });
			await addOpenReports('meme', row.id, author.id, reports);
			return author;
		}

		it('404s both the original and the thumbnail key for a member', async () => {
			await reportedMeme(OVER_THRESHOLD);
			const member = await testUser();
			const cookie = await createSession(member.id);
			for (const key of [OBJ, THUMB]) {
				const res = await request(`/media/${key}`, cookie);
				expect(res.status).toBe(404);
				expect(res.headers.get('location')).toBeNull();
			}
		});

		it('also 404s for the author', async () => {
			const author = await reportedMeme(OVER_THRESHOLD);
			const res = await request(`/media/${OBJ}`, await createSession(author.id));
			expect(res.status).toBe(404);
		});

		it.each(['moderator', 'admin'] as const)('still redirects for a %s', async (role) => {
			await reportedMeme(OVER_THRESHOLD);
			const user = await testUser({ role });
			const cookie = await createSession(user.id);
			for (const key of [OBJ, THUMB]) {
				expect((await request(`/media/${key}`, cookie)).status).toBe(302);
			}
		});

		it('serves a meme exactly at the threshold', async () => {
			await reportedMeme(env.REPORT_REVIEW_THRESHOLD);
			const member = await testUser();
			const cookie = await createSession(member.id);
			for (const key of [OBJ, THUMB]) {
				expect((await request(`/media/${key}`, cookie)).status).toBe(302);
			}
		});
	});
});
