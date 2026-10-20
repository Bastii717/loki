import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server';
import { createSession } from '../../lib/server/auth/session';
import { resetDb, setupDb, testUser } from '../../lib/server/db/test-utils';
import { env } from '../../lib/server/env';
import { deleteObjects, putObject } from '../../lib/server/storage';
import { ensureBucket } from '../../lib/server/storage-test-utils';
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
});
