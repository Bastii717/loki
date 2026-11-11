import { json, type RequestEvent } from '@sveltejs/kit';

export const RULES_REQUIRED_MESSAGE = 'Please accept the house rules first.';

/** Paths a member must still reach without having accepted: the /welcome page with its accept action, and signing out (login paths are public). */
const EXEMPT_PATHS = new Set(['/welcome', '/logout']);

export function isRulesGateExempt(path: string): boolean {
	return EXEMPT_PATHS.has(path);
}

/**
 * 403 for a write before the house rules are accepted, in the shape the client of that request
 * understands (same three shapes as the write lock): JSON for `/api/*`, the ActionResult JSON for
 * a `use:enhance` form action, plain text for a plain form post.
 */
export function rulesRequiredResponse(event: RequestEvent, path: string): Response {
	const status = 403;
	if (path === '/api' || path.startsWith('/api/')) {
		return json({ message: RULES_REQUIRED_MESSAGE }, { status });
	}
	if (event.request.headers.get('x-sveltekit-action') === 'true') {
		return json(
			{
				type: 'failure',
				status,
				// devalue encoding of { message, error } (equal values share one slot)
				data: JSON.stringify([{ message: 1, error: 1 }, RULES_REQUIRED_MESSAGE])
			},
			{ status }
		);
	}
	return new Response(RULES_REQUIRED_MESSAGE, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
}
