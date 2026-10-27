import { deserialize } from '$app/forms';
import { readFileSync } from 'node:fs';
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
import { configureMaintenance, resetMaintenance } from './lib/server/maintenance';
import { userWithSession } from './lib/server/moderation-test-utils';
import { configureSeasons, resetSeasons } from './lib/server/seasons';
import { configureReadiness, resetReadiness, setMigrated } from './lib/server/readiness';
import { handle, mediaOrigin } from './hooks.server';

beforeAll(async () => {
	init_transport({});
	await setupDb();
});
beforeEach(async () => {
	resetRateLimits();
	resetReadiness();
	resetMaintenance();
	resetSeasons();
	setMigrated(true);
	// the readiness probes would hit the real database and bucket; these tests steer them by hand
	configureReadiness({ dbProbe: async () => true, storageProbe: async () => true });
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

	it('compares the decoded path: an encoded public path is public, an encoded protected one is not', async () => {
		expect((await run('/log%69n').response).status).toBe(200);
		expect((await run('/%6Demes').response).status).toBe(303);
		expect((await run('/api/%66eed').response).status).toBe(401);
	});

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
		expect(r.event.locals.user).toEqual({
			id: user.id,
			username: user.username,
			displayName: null,
			role: 'admin'
		});
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
	const MESSAGE = 'Slow down, Lord! Too many requests.';

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
		expect(result).toEqual({
			type: 'failure',
			status: 429,
			data: { message: MESSAGE, error: MESSAGE }
		});
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

describe('outage page', () => {
	const TITLE = 'Loki is taking a break';

	// /healthz and /readyz are routes of their own; here `resolve` stands in for them
	const readyz = (ready: boolean) => new Response(null, { status: ready ? 200 : 503 });

	async function expectOutageWithProbes() {
		const page = await run('/').response;
		expect(page.status).toBe(503);
		expect(page.headers.get('content-type')).toContain('text/html');
		expect(page.headers.get('retry-after')).toBe('30');
		expect(await page.text()).toContain(TITLE);
		const api = run('/api/feed');
		expect((await api.response).status).toBe(503);
		expect(api.calls()).toBe(0);
		const healthz = run('/healthz');
		expect((await healthz.response).status).toBe(200);
		expect(healthz.calls()).toBe(1);
		const ready = run('/readyz', undefined, readyz(false));
		expect((await ready.response).status).toBe(503);
		expect(ready.calls()).toBe(1);
	}

	it('serves the outage page while the database is down', async () => {
		configureReadiness({ dbProbe: async () => false });
		await expectOutageWithProbes();
	});

	it('serves the outage page while the migrations have not run', async () => {
		setMigrated(false);
		await expectOutageWithProbes();
	});

	it('serves the outage page before the session is resolved (login and callback too)', async () => {
		configureReadiness({ dbProbe: async () => false });
		const { session } = await userWithSession();
		for (const path of ['/login', '/auth/callback', '/memes']) {
			const r = run(path, session);
			expect((await r.response).status).toBe(503);
			expect(r.calls()).toBe(0);
			expect(r.event.locals.user).toBeUndefined();
		}
	});

	it('answers /healthz and /readyz with a session cookie while the database is down, not a 500', async () => {
		const { session } = await userWithSession();
		configureReadiness({ dbProbe: async () => false });
		const healthz = run('/healthz', session);
		expect((await healthz.response).status).toBe(200);
		expect(healthz.calls()).toBe(1);
		const ready = run('/readyz', session, readyz(false));
		expect((await ready.response).status).toBe(503);
		expect(ready.calls()).toBe(1);
		// no session lookup happened for either
		expect(healthz.event.locals.user).toBeNull();
		expect(ready.event.locals.user).toBeNull();
		expect(healthz.deleted).toEqual([]);
	});

	it('leaves the public assets alone', async () => {
		configureReadiness({ dbProbe: async () => false });
		for (const path of [
			'/maintenance.html',
			'/favicon.ico',
			'/manifest.webmanifest',
			'/robots.txt',
			'/icons/icon-192.png',
			'/_app/immutable/x.js',
			'/_app/version.json'
		]) {
			const r = run(path);
			expect((await r.response).status).toBe(200);
			expect(r.calls()).toBe(1);
		}
	});

	it('treats an unreadable maintenance row as an outage, not a 500', async () => {
		const { session } = await userWithSession();
		configureMaintenance({
			load: () => {
				throw new Error('relation missing');
			}
		});
		const res = await run('/', session).response;
		expect(res.status).toBe(503);
		expect(await res.text()).toContain(TITLE);
	});
});

describe('maintenance write guard', () => {
	const MAINTENANCE_TEXT = 'Loki is under maintenance. Reading works, posting is paused.';
	const STARTING_TEXT =
		'Loki is still starting up. Posting, voting and commenting are back in a moment.';
	const enable = () =>
		configureMaintenance({
			load: async () => ({ enabled: true, message: '', startsAt: null, until: null })
		});

	it('locks member writes with the three response shapes', async () => {
		enable();
		const { session } = await userWithSession('member');

		const api = run('/api/memes/1/vote', session, new Response('ok'), 'POST');
		const apiRes = await api.response;
		expect(apiRes.status).toBe(503);
		expect(apiRes.headers.get('retry-after')).toBe('60');
		expect(apiRes.headers.get('content-type')).toContain('application/json');
		expect(await apiRes.json()).toEqual({ message: MAINTENANCE_TEXT });
		expect(api.calls()).toBe(0);

		const action = await run('/upload', session, new Response('ok'), 'POST', {
			'x-sveltekit-action': 'true'
		}).response;
		expect(action.status).toBe(503);
		expect(action.headers.get('retry-after')).toBe('60');
		expect(deserialize(await action.text())).toEqual({
			type: 'failure',
			status: 503,
			data: { message: MAINTENANCE_TEXT, error: MAINTENANCE_TEXT }
		});

		const form = await run('/quotes', session, new Response('ok'), 'POST').response;
		expect(form.status).toBe(503);
		expect(form.headers.get('retry-after')).toBe('60');
		expect(form.headers.get('content-type')).toContain('text/plain');
		expect(await form.text()).toBe(MAINTENANCE_TEXT);
	});

	it('answers a percent-encoded /api path with the JSON shape', async () => {
		enable();
		const { session } = await userWithSession('member');
		const res = await run('/%61pi/memes/1/vote', session, new Response('ok'), 'POST').response;
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ message: MAINTENANCE_TEXT });
	});

	it('locks PATCH and DELETE but not reads', async () => {
		enable();
		const { session } = await userWithSession('member');
		for (const method of ['PATCH', 'DELETE']) {
			const res = await run('/api/memes/1', session, new Response('ok'), method).response;
			expect(res.status).toBe(503);
		}
		const read = run('/api/feed', session);
		expect((await read.response).status).toBe(200);
		expect(read.calls()).toBe(1);
	});

	it('lets an admin write during maintenance', async () => {
		enable();
		const { session } = await userWithSession('admin');
		const r = run('/api/memes/1/vote', session, new Response('ok'), 'POST');
		const res = await r.response;
		expect(res.status).toBe(200);
		expect(r.calls()).toBe(1);
	});

	it('locks moderators like members', async () => {
		enable();
		const { session } = await userWithSession('moderator');
		const res = await run('/api/memes/1/vote', session, new Response('ok'), 'POST').response;
		expect(res.status).toBe(503);
	});

	it('locks admins too while storage is not ready', async () => {
		configureReadiness({ storageProbe: async () => false });
		const { session } = await userWithSession('admin');
		const res = await run('/api/memes/1/vote', session, new Response('ok'), 'POST').response;
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ message: STARTING_TEXT });
	});

	it('keeps these paths writable during maintenance', async () => {
		enable();
		// a moderator is locked like a member but may reach /moderation
		const { session } = await userWithSession('moderator');
		for (const path of [
			'/logout',
			'/login',
			'/auth/callback',
			'/api/memes/1/seen',
			'/share',
			'/moderation/maintenance',
			'/moderation/maintenance?/off'
		]) {
			const r = run(path, session, new Response('ok'), 'POST');
			expect((await r.response).status, path).not.toBe(503);
			expect(r.calls(), path).toBe(1);
		}
	});

	it('matches the exemptions exactly', async () => {
		enable();
		const { session } = await userWithSession('member');
		for (const path of [
			'/api/memes/1/seen/x',
			'/api/memes/x/seen',
			'/logout/x',
			'/login/x',
			'/auth/callback/x',
			'/share/x'
		]) {
			const res = await run(path, session, new Response('ok'), 'POST').response;
			expect(res.status, path).toBe(503);
		}
	});

	it('does not guard unauthenticated requests (the auth guard answers them)', async () => {
		enable();
		const res = await run('/api/memes/1/vote', undefined, new Response('ok'), 'POST').response;
		expect(res.status).toBe(401);
	});

	it('writes normally when the switch is off', async () => {
		const { session } = await userWithSession('member');
		const r = run('/api/memes/1/vote', session, new Response('ok'), 'POST');
		expect((await r.response).status).toBe(200);
		expect(r.calls()).toBe(1);
	});
});

describe('season attribute', () => {
	const HTML = '<html lang="en"><body></body></html>';

	/** Runs the hook with a resolve stub that applies `transformPageChunk` to a minimal document. */
	async function render(
		path: string,
		cookie?: string
	): Promise<{ html: string; locals: App.Locals }> {
		const r = run(path, cookie);
		const resolve = (async (
			_event: RequestEvent,
			opts?: Parameters<Parameters<Handle>[0]['resolve']>[1]
		) =>
			new Response(
				opts?.transformPageChunk ? await opts.transformPageChunk({ html: HTML, done: true }) : HTML
			)) as Parameters<Handle>[0]['resolve'];
		const res = await handle({ event: r.event, resolve });
		return { html: await res.text(), locals: r.event.locals };
	}

	const forceHalloween = () =>
		configureSeasons({ load: async () => ({ mode: 'forced', theme: 'halloween', until: null }) });

	it('adds data-season to the html tag and sets locals.season', async () => {
		forceHalloween();
		const { session } = await userWithSession('member');
		const { html, locals } = await render('/', session);
		expect(html).toBe('<html lang="en" data-season="halloween"><body></body></html>');
		expect(locals.season).toEqual({ id: 'halloween', source: 'forced' });
	});

	it('leaves the tag untouched when no season is active', async () => {
		configureSeasons({ load: async () => ({ mode: 'off', theme: null, until: null }) });
		const { session } = await userWithSession('member');
		const { html, locals } = await render('/', session);
		expect(html).toBe(HTML);
		expect(locals.season).toBeNull();
	});

	it('is present on the login page without a session', async () => {
		forceHalloween();
		const { html, locals } = await render('/login');
		expect(html).toContain('data-season="halloween"');
		expect(locals.season?.id).toBe('halloween');
	});

	it('lets an admin preview a season with ?season=', async () => {
		forceHalloween();
		const { session } = await userWithSession('admin');
		const { html, locals } = await render('/?season=advent', session);
		expect(html).toContain('data-season="advent"');
		expect(locals.season).toEqual({ id: 'advent', source: 'preview' });
	});

	it('ignores ?season= for members and anonymous visitors', async () => {
		forceHalloween();
		const { session } = await userWithSession('member');
		expect((await render('/?season=advent', session)).html).toContain('data-season="halloween"');
		expect((await render('/login?season=advent')).html).toContain('data-season="halloween"');
	});

	it('ignores an unknown ?season= id, also for admins', async () => {
		forceHalloween();
		const { session } = await userWithSession('admin');
		const { html, locals } = await render('/?season=nope', session);
		expect(html).toContain('data-season="halloween"');
		expect(locals.season?.source).toBe('forced');
	});

	it('degrades to no theme when the season lookup fails, and spares the health paths', async () => {
		let loads = 0;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureSeasons({
			load: async () => {
				loads += 1;
				throw new Error('db down');
			}
		});
		const { session } = await userWithSession('member');
		expect((await run('/healthz').response).status).toBe(200);
		expect(loads).toBe(0);
		const { html, locals } = await render('/', session);
		expect(html).toBe(HTML);
		expect(locals.season).toBeNull();
		expect(warn).toHaveBeenCalledWith('season resolution failed', expect.any(Error));
		warn.mockRestore();
	});

	it('never loads the season for API requests', async () => {
		let loads = 0;
		configureSeasons({
			load: async () => {
				loads += 1;
				return { mode: 'forced', theme: 'halloween', until: null };
			}
		});
		const { session } = await userWithSession('member');
		const r = run('/api/feed', session);
		await r.response;
		expect(loads).toBe(0);
		expect(r.event.locals.season).toBeNull();
	});

	it('does not touch the outage page', async () => {
		forceHalloween();
		configureMaintenance({
			load: () => {
				throw new Error('relation missing');
			}
		});
		const r = run('/');
		const res = await r.response;
		expect(res.status).toBe(503);
		expect(r.event.locals.season).toBeNull();
		expect(await res.text()).not.toContain('data-season');
	});
});

describe('app.html', () => {
	it('keeps the html tag the season attribute injection replaces', () => {
		// the hook's transformPageChunk replaces this exact tag to add data-season, so changing it silently drops the theme
		const html = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
		expect(html).toContain('<html lang="en"');
	});
});
