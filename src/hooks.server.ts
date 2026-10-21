import { json } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, resolveSession } from './lib/server/auth/session';
import { runMigrations } from './lib/server/db';
import { env } from './lib/server/env';
import { startJobs } from './lib/server/jobs';
import { rateLimitRetryMs } from './lib/server/rate-limit';

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

const MODERATION_ROOTS = ['/moderation', '/api/moderation'];
const isModerationPath = (path: string) =>
	MODERATION_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
const FORBIDDEN_MESSAGE = 'Dieser Bereich ist nur für Moderatoren und Admins.';

const SEEN_PATH = /^\/api\/memes\/\d+\/seen$/;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
const RATE_LIMITED_MESSAGE = 'Langsam, Lord! Zu viele Anfragen.';

/** Per-user limits for state-changing requests (in-memory, see rate-limit.ts). Returns the seconds to wait, or 0 when allowed. */
function retryAfterSeconds(method: string, path: string, userId: number): number {
	if (!WRITE_METHODS.has(method)) return 0;
	const wait = (key: string, limit: number, windowMs: number) =>
		Math.ceil(rateLimitRetryMs(`${key}:${userId}`, limit, windowMs) / 1000);
	// Seen-tracking fires once per swiped slide; fast swiping must not eat the write budget.
	if (method === 'POST' && SEEN_PATH.test(path)) return wait('seen', 300, 60_000);
	const writes = wait('write', 60, 60_000);
	if (writes > 0) return writes;
	if (method === 'POST' && (path === '/upload' || path.startsWith('/upload/'))) {
		return wait('upload', 10, 5 * 60_000);
	}
	return 0;
}

/**
 * 429 for a `use:enhance` form action. The client's `deserialize` only understands the
 * ActionResult JSON (`data` is devalue-encoded), so a plain-text body would surface as a
 * generic error instead of the German message in the form's error slot.
 */
function actionRateLimited(retryAfter: number): Response {
	return json(
		// devalue encoding of { message, error } (equal values share one slot): the upload form
		// reads `form.message`, quotes and the rules/FAQ editor read `form.error`
		{
			type: 'failure',
			status: 429,
			data: JSON.stringify([{ message: 1, error: 1 }, RATE_LIMITED_MESSAGE])
		},
		{ status: 429, headers: { 'retry-after': String(retryAfter) } }
	);
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
	// Defense in depth: every moderation page and API checks the role itself (requireModerator);
	// this keeps members out even if a future route forgets to. Timeouts are handled there.
	const role = event.locals.user?.role;
	if (role && role !== 'moderator' && role !== 'admin' && isModerationPath(path)) {
		if (path.startsWith('/api/'))
			return secure(json({ error: FORBIDDEN_MESSAGE }, { status: 403 }));
		return secure(
			new Response(FORBIDDEN_MESSAGE, {
				status: 403,
				headers: { 'content-type': 'text/plain; charset=utf-8' }
			})
		);
	}
	const retryAfter = event.locals.user
		? retryAfterSeconds(event.request.method, path, event.locals.user.id)
		: 0;
	if (retryAfter > 0) {
		const status = 429;
		const headers = { 'retry-after': String(retryAfter) };
		if (path === '/api' || path.startsWith('/api/')) {
			return secure(json({ error: RATE_LIMITED_MESSAGE }, { status, headers }));
		}
		if (event.request.headers.get('x-sveltekit-action') === 'true') {
			return secure(actionRateLimited(retryAfter));
		}
		return secure(
			new Response(RATE_LIMITED_MESSAGE, {
				status,
				headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' }
			})
		);
	}
	return secure(await resolve(event));
};
