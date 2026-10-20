import { json } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, resolveSession } from './lib/server/auth/session';
import { runMigrations } from './lib/server/db';
import { env } from './lib/server/env';

/** Runs once at server start so misconfiguration fails at boot, not on the first request. */
export const init: ServerInit = async () => {
	void env.DATABASE_URL; // validate the whole environment eagerly
	await runMigrations();
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
	PUBLIC_PATHS.has(path) || path.startsWith('/_app/immutable/') || path === '/_app/version.json';

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
		const s3 = new URL(env.S3_ENDPOINT).origin;
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
	return secure(await resolve(event));
};
