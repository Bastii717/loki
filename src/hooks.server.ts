import { json } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, resolveSession } from './lib/server/auth/session';
import { runMigrations } from './lib/server/db';
import { env } from './lib/server/env';
import { startJobs } from './lib/server/jobs';
import { rateLimit } from './lib/server/rate-limit';

/** Runs once at server start so misconfiguration fails at boot, not on the first request. */
export const init: ServerInit = async () => {
	void env.DATABASE_URL; // validate the whole environment eagerly
	await runMigrations();
	startJobs();
};

const PUBLIC_PATHS = new Set([
	'/login',
	'/auth/callback',
	'/healthz',
	'/favicon.ico',
	'/favicon.svg',
	'/manifest.webmanifest',
	'/robots.txt'
]);

const isPublic = (path: string) =>
	PUBLIC_PATHS.has(path) ||
	path.startsWith('/icons/') || // PWA install fetches icons without credentials
	path.startsWith('/_app/immutable/') ||
	path === '/_app/version.json';

const SEEN_PATH = /^\/api\/memes\/\d+\/seen$/;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
const RATE_LIMITED_MESSAGE = 'Langsam, Lord! Zu viele Anfragen.';

/** Per-user limits for state-changing requests (in-memory, see rate-limit.ts). */
function limited(method: string, path: string, userId: number): boolean {
	if (!WRITE_METHODS.has(method)) return false;
	// Seen-tracking fires once per swiped slide; fast swiping must not eat the write budget.
	if (method === 'POST' && SEEN_PATH.test(path)) {
		return !rateLimit(`seen:${userId}`, 300, 60_000);
	}
	if (!rateLimit(`write:${userId}`, 60, 60_000)) return true;
	if (method === 'POST' && (path === '/upload' || path.startsWith('/upload/'))) {
		return !rateLimit(`upload:${userId}`, 10, 5 * 60_000);
	}
	return false;
}

/**
 * Origin the browser fetches presigned media from. With path-style addressing that is the
 * endpoint itself; otherwise (Cloudflare R2) the SDK presigns `https://<bucket>.<host>`.
 */
export function mediaOrigin(endpoint: string, bucket: string, forcePathStyle: boolean): string {
	const url = new URL(endpoint);
	return forcePathStyle ? url.origin : `${url.protocol}//${bucket}.${url.host}`;
}

let cachedMediaOrigin: string | undefined;

/** Adds `origin` to the sources of `directive` in a CSP header value. */
function addSource(csp: string, directive: string, origin: string): string {
	return csp
		.split(';')
		.map((part) => {
			const trimmed = part.trim();
			return trimmed === directive || trimmed.startsWith(`${directive} `)
				? `${trimmed} ${origin}`
				: trimmed;
		})
		.filter(Boolean)
		.join('; ');
}

function secure(response: Response): Response {
	const headers = response.headers;
	headers.set('Referrer-Policy', 'same-origin');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');

	// SvelteKit's `csp` config (vite.config.ts) emits the nonce-based policy; the S3
	// origin is only known at runtime, so it is appended here.
	const csp = headers.get('content-security-policy');
	if (csp) {
		cachedMediaOrigin ??= mediaOrigin(env.S3_ENDPOINT, env.S3_BUCKET, env.S3_FORCE_PATH_STYLE);
		const s3 = cachedMediaOrigin;
		headers.set(
			'content-security-policy',
			addSource(addSource(csp, 'img-src', s3), 'media-src', s3)
		);
	}
	return response;
}

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const session = token ? await resolveSession(token) : null;
	event.locals.user = session?.user ?? null;
	if (token && session?.renewed) event.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
	if (token && !event.locals.user) event.cookies.delete(SESSION_COOKIE, { path: '/' });

	const path = event.url.pathname;
	if (!event.locals.user && !isPublic(path)) {
		if (path === '/api' || path.startsWith('/api/')) {
			return secure(json({ error: 'Unauthorized' }, { status: 401 }));
		}
		return secure(new Response(null, { status: 303, headers: { location: '/login' } }));
	}
	if (event.locals.user && limited(event.request.method, path, event.locals.user.id)) {
		const status = 429;
		return secure(
			path === '/api' || path.startsWith('/api/')
				? json({ error: RATE_LIMITED_MESSAGE }, { status })
				: new Response(RATE_LIMITED_MESSAGE, {
						status,
						headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' }
					})
		);
	}
	return secure(await resolve(event));
};
