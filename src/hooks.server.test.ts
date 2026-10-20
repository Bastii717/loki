import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from './lib/server/env';
import { createSession } from './lib/server/auth/session';
import { db } from './lib/server/db';
import { sessions } from './lib/server/db/schema';
import { resetDb, setupDb, testUser } from './lib/server/db/test-utils';
import { handle } from './hooks.server';

beforeAll(setupDb);
beforeEach(resetDb);

function run(path: string, cookie?: string, resolved: Response = new Response('ok')) {
	const deleted: string[] = [];
	const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const event = {
		url: new URL(`https://loki.test${path}`),
		request: new Request(`https://loki.test${path}`),
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
