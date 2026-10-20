import { deserialize } from '$app/forms';
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from './lib/server/env';
import { createSession } from './lib/server/auth/session';
import { db } from './lib/server/db';
import { sessions } from './lib/server/db/schema';
import { resetDb, setupDb, testUser } from './lib/server/db/test-utils';
// the real client-side parser; kit initializes its transport at app start, tests must do it by hand
// @ts-expect-error kit's internal module ships no declarations
import { init_transport } from '../node_modules/@sveltejs/kit/src/runtime/app/internal/transport.js';
import { resetRateLimits } from './lib/server/rate-limit';
import { handle, mediaOrigin } from './hooks.server';

beforeAll(async () => {
	init_transport({});
	await setupDb();
});
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

function run(
	path: string,
	cookie?: string,
	resolved: Response = new Response('ok'),
	method = 'GET',
	headers: Record<string, string> = {}
) {
	const deleted: string[] = [];
	const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const event = {
		url: new URL(`https://loki.test${path}`),
		request: new Request(`https://loki.test${path}`, { method, headers }),
		cookies: {
			get: (name: string) => (name === 'loki_session' ? cookie : undefined),
			delete: (name: string) => void deleted.push(name),
			set: (name: string, value: string, opts: Record<string, unknown>) =>
				void set.push({ name, value, opts })
		},
		locals: {} as App.Locals
	} as unknown as RequestEvent;
	let resolveCalls = 0;
	const resolve = (async () => {
		resolveCalls += 1;
		return resolved;
	}) as Parameters<Handle>[0]['resolve'];
	return {
		event,
		deleted,
		set,
		calls: () => resolveCalls,
		response: Promise.resolve(handle({ event, resolve }))
	};
}

describe('auth guard', () => {
	it('redirects unauthenticated page requests to /login', async () => {
		const r = run('/memes');
		const res = await r.response;
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/login');
		expect(r.calls()).toBe(0);
		expect(r.event.locals.user).toBeNull();
	});

	it('returns 401 JSON for unauthenticated API requests', async () => {
		const res = await run('/api/feed').response;
		expect(res.status).toBe(401);
		expect(res.headers.get('content-type')).toContain('application/json');
	});

	it.each([
		'/healthz',
		'/login',
		'/auth/callback',
		'/_app/immutable/x.js',
		'/_app/version.json',
		'/robots.txt'
	])('lets %s through without a session', async (path) => {
		const r = run(path);
		const res = await r.response;
		expect(res.status).toBe(200);
		expect(r.calls()).toBe(1);
	});

	it.each(['/loginX', '/login/', '/api-anything', '/_app/remote/x', '/_app/other'])(
		'does not treat %s as public',
		async (path) => {
			const r = run(path);
			const res = await r.response;
			expect(res.status).toBe(303);
			expect(r.calls()).toBe(0);
		}
	);

	it('returns 401 for bare /api', async () => {
		expect((await run('/api').response).status).toBe(401);
	});

	it('re-sets the cookie with maxAge when the session is renewed', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		await db
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) })
			.where(eq(sessions.userId, user.id));
		const r = run('/memes', token);
		await r.response;
		expect(r.set).toHaveLength(1);
		expect(r.set[0].value).toBe(token);
		expect(r.set[0].opts).toMatchObject({ maxAge: 2592000, httpOnly: true, secure: true });
	});

	it('does not re-set the cookie for a fresh session', async () => {
		const user = await testUser();
		const r = run('/memes', await createSession(user.id));
		await r.response;
		expect(r.set).toHaveLength(0);
	});

	it('sets locals.user for a valid session cookie', async () => {
		const user = await testUser({ role: 'admin' });
		const token = await createSession(user.id);
		const r = run('/memes', token);
		const res = await r.response;
		expect(res.status).toBe(200);
		expect(r.event.locals.user).toEqual({ id: user.id, username: user.username, role: 'admin' });
	});

	it('clears an invalid cookie and redirects', async () => {
		const r = run('/memes', 'bogus');
		const res = await r.response;
		expect(res.status).toBe(303);
		expect(r.deleted).toEqual(['loki_session']);
	});
});

describe('security headers', () => {
	it('adds static headers', async () => {
		const res = await run('/healthz').response;
		expect(res.headers.get('referrer-policy')).toBe('same-origin');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
	});

	it('extends img-src and media-src of the CSP with the S3 origin', async () => {
		const csp = `default-src 'self'; img-src 'self' data:; media-src 'self'; script-src 'self' 'nonce-abc'`;
		const resolved = new Response('x', { headers: { 'content-security-policy': csp } });
		const res = await run('/healthz', undefined, resolved).response;
		const origin = new URL(env.S3_ENDPOINT).origin;
		const header = res.headers.get('content-security-policy')!;
		expect(header).toContain(`img-src 'self' data: ${origin}`);
		expect(header).toContain(`media-src 'self' ${origin}`);
		expect(header).toContain(`script-src 'self' 'nonce-abc'`);
	});
});

describe('media origin for the CSP', () => {
	it('uses the endpoint origin with path-style addressing', () => {
		expect(mediaOrigin('http://minio.lan:9000/', 'loki', true)).toBe('http://minio.lan:9000');
	});

	it('uses the bucket virtual host without path-style addressing (R2)', () => {
		expect(mediaOrigin('https://acc.r2.cloudflarestorage.com', 'loki', false)).toBe(
			'https://loki.acc.r2.cloudflarestorage.com'
		);
		expect(mediaOrigin('http://s3.lan:9000', 'loki', false)).toBe('http://loki.s3.lan:9000');
	});

	it('keeps the EU jurisdiction subdomain of R2', () => {
		expect(mediaOrigin('https://acc.eu.r2.cloudflarestorage.com', 'loki', false)).toBe(
			'https://loki.acc.eu.r2.cloudflarestorage.com'
		);
	});

	it('puts the configured origin into img-src and media-src', async () => {
		const csp = `img-src 'self'; media-src 'self'`;
		const resolved = new Response('x', { headers: { 'content-security-policy': csp } });
		const res = await run('/healthz', undefined, resolved).response;
		const expected = mediaOrigin(env.S3_ENDPOINT, env.S3_BUCKET, env.S3_FORCE_PATH_STYLE);
		expect(res.headers.get('content-security-policy')).toBe(
			`img-src 'self' ${expected}; media-src 'self' ${expected}`
		);
	});
});

describe('write rate limits', () => {
	it('gives seen-tracking its own, larger bucket', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		for (let i = 0; i < 100; i++) {
			const res = await run('/api/memes/1/seen', token, new Response('ok'), 'POST').response;
			expect(res.status).toBe(200);
		}
		// seen requests did not consume the regular write budget
		const vote = await run('/api/memes/1/vote', token, new Response('ok'), 'POST').response;
		expect(vote.status).toBe(200);
	});

	it('still caps seen-tracking at 300 per minute', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		let last = 200;
		for (let i = 0; i < 301; i++) {
			last = (await run('/api/memes/1/seen', token, new Response('ok'), 'POST').response).status;
		}
		expect(last).toBe(429);
	});

	it('keeps the 60/min cap for other writes', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		let last = 200;
		for (let i = 0; i < 61; i++) {
			last = (await run('/api/memes/1/vote', token, new Response('ok'), 'POST').response).status;
		}
		expect(last).toBe(429);
	});
});

describe('429 responses', () => {
	const MESSAGE = 'Langsam, Lord! Zu viele Anfragen.';

	async function tripUpload(headers: Record<string, string> = {}) {
		const user = await testUser();
		const token = await createSession(user.id);
		for (let i = 0; i < 10; i++) {
			const ok = await run('/upload', token, new Response('ok'), 'POST', headers).response;
			expect(ok.status).toBe(200);
		}
		return run('/upload', token, new Response('ok'), 'POST', headers).response;
	}

	it('answers a use:enhance action with an ActionResult the client can deserialize', async () => {
		const res = await tripUpload({ 'x-sveltekit-action': 'true' });
		expect(res.status).toBe(429);
		expect(res.headers.get('content-type')).toContain('application/json');
		const result = deserialize(await res.text());
		expect(result).toEqual({ type: 'failure', status: 429, data: { message: MESSAGE } });
	});

	it('keeps text/plain for a plain (non-enhanced) form post', async () => {
		const res = await tripUpload();
		expect(res.status).toBe(429);
		expect(res.headers.get('content-type')).toContain('text/plain');
		expect(await res.text()).toBe(MESSAGE);
	});

	it('reports the remaining window in Retry-After (upload bucket is 5 minutes)', async () => {
		const res = await tripUpload();
		expect(res.headers.get('retry-after')).toBe(String(5 * 60));
	});

	it('shrinks Retry-After as the window slides', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			const user = await testUser();
			const token = await createSession(user.id);
			for (let i = 0; i < 10; i++) await run('/upload', token, new Response('ok'), 'POST').response;
			vi.advanceTimersByTime(100_000);
			const res = await run('/upload', token, new Response('ok'), 'POST').response;
			expect(res.status).toBe(429);
			expect(res.headers.get('retry-after')).toBe('200');
		} finally {
			vi.useRealTimers();
		}
	});

	it('uses the 60s window for the general write bucket, also on API paths', async () => {
		const user = await testUser();
		const token = await createSession(user.id);
		for (let i = 0; i < 60; i++)
			await run('/api/memes/1/vote', token, new Response('ok'), 'POST').response;
		const res = await run('/api/memes/1/vote', token, new Response('ok'), 'POST').response;
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('60');
		expect(await res.json()).toEqual({ error: MESSAGE });
	});
});
