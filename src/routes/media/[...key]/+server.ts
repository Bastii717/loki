import { error } from '@sveltejs/kit';
import { getPresignedUrl } from '../../../lib/server/storage';
import type { RequestHandler } from './$types';

const PRESIGN_TTL_SECONDS = 60;

/**
 * Accepts only canonical keys under `memes/`. Runs on the already-decoded rest param,
 * so encoded traversal (`%2e%2e`, `%2F`) is checked in its decoded form; any remaining
 * `%`, backslash or control character (double-encoding, NUL) is rejected outright.
 */
function isValidKey(key: string): boolean {
	if (!/^memes\//.test(key)) return false;
	if (/[%\\]/.test(key)) return false;
	if ([...key].some((c) => c.charCodeAt(0) < 0x20)) return false;
	return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export const GET: RequestHandler = async ({ params, locals }) => {
	// The global guard already blocks anonymous requests; this keeps the route safe on its own.
	if (!locals.user) error(401, 'Unauthorized');
	const key = params.key;
	if (!isValidKey(key)) error(404, 'Not found');
	const location = await getPresignedUrl(key, PRESIGN_TTL_SECONDS);
	return new Response(null, {
		status: 302,
		headers: { location, 'cache-control': 'private, max-age=30' }
	});
};
