import { json, type RequestEvent } from '@sveltejs/kit';
import { isSeenPath } from '../public-id';

const RETRY_AFTER = '60';
const EXEMPT_PATHS = new Set([
	'/logout',
	'/login',
	'/welcome',
	'/auth/callback',
	'/share',
	'/notifications',
	'/moderation/maintenance'
]);

/** Paths that keep working while writes are locked: signing out and in, seen-tracking, the house-rules accept action on /welcome (its only mutation; accepting is not a content write, and the rules gate sends everyone there), the share target, the notifications page (opening a notice marks it read) and the switch itself. */
export function isWriteLockExempt(path: string): boolean {
	return EXEMPT_PATHS.has(path) || isSeenPath(path);
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
