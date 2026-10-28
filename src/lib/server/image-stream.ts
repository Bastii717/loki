import { error } from '@sveltejs/kit';

const INT4_MAX = 2_147_483_647;

/** A route id as a positive int4; anything else is a 404 (and never reaches the database). */
export function parseId(raw: string): number {
	const id = Number(raw);
	if (!Number.isSafeInteger(id) || id <= 0 || id > INT4_MAX) error(404, 'Not found');
	return id;
}

/** A same-origin image response for the generator's canvas: private, cached for an hour, no sniffing. */
export function imageResponse(body: Buffer, contentType: string): Response {
	return new Response(new Uint8Array(body), {
		headers: {
			'content-type': contentType,
			'cache-control': 'private, max-age=3600',
			'x-content-type-options': 'nosniff'
		}
	});
}
