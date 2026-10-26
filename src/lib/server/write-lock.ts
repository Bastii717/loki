import { json, type RequestEvent } from '@sveltejs/kit';

const RETRY_AFTER = '60';
const EXEMPT_PATHS = new Set([
	'/logout',
	'/login',
	'/auth/callback',
	'/share',
	'/moderation/maintenance'
]);
const SEEN_PATH = /^\/api\/memes\/\d+\/seen$/;

/** Paths that keep working while writes are locked: signing out and in, seen-tracking, the share target and the switch itself. */
export function isWriteLockExempt(path: string): boolean {
	return EXEMPT_PATHS.has(path) || SEEN_PATH.test(path);
}

/**
 * 503 for a locked write on `path` (the routed, decoded pathname), in the shape the client of that request understands: JSON for `/api/*`,
 * the ActionResult JSON for a `use:enhance` form action (`deserialize` expects devalue-encoded
 * `data`), plain text for a plain form post.
 */
export function writeLockResponse(event: RequestEvent, message: string, path: string): Response {
	const status = 503;
	const headers = { 'retry-after': RETRY_AFTER };
	if (path === '/api' || path.startsWith('/api/')) {
		return json({ message }, { status, headers });
	}
	if (event.request.headers.get('x-sveltekit-action') === 'true') {
		return json(
			// devalue encoding of { message, error } (equal values share one slot)
			{ type: 'failure', status, data: JSON.stringify([{ message: 1, error: 1 }, message]) },
			{ status, headers }
		);
	}
	return new Response(message, {
		status,
		headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' }
	});
}
