import { error } from '@sveltejs/kit';
import { deleteMedia, MediaPermissionError, setFlags } from '../../../../lib/server/memes';
import { mapModerationError } from '../../../../lib/server/moderation-http';
import { resolveMediaId } from '../../../../lib/server/public-ids';
import { MediaNotFoundError } from '../../../../lib/server/votes';
import type { RequestHandler } from './$types';

/** The meme's internal id for a public id from the URL; an invalid or unknown id is a 404. */
async function parseId(pid: string): Promise<number> {
	const id = await resolveMediaId(pid);
	if (id === null) error(404, 'Not found');
	return id;
}

function mapError(e: unknown): never {
	if (e instanceof MediaNotFoundError) error(404, 'Not found');
	if (e instanceof MediaPermissionError) error(403, 'Forbidden');
	mapModerationError(e);
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
	try {
		await deleteMedia(locals.user!, await parseId(params.pid));
	} catch (e) {
		mapError(e);
	}
	return new Response(null, { status: 204 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = await parseId(params.pid);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const { nsfw, spoiler } = (body ?? {}) as { nsfw?: unknown; spoiler?: unknown };
	if (
		(nsfw !== undefined && typeof nsfw !== 'boolean') ||
		(spoiler !== undefined && typeof spoiler !== 'boolean') ||
		(nsfw === undefined && spoiler === undefined)
	) {
		error(400, 'nsfw and/or spoiler must be booleans');
	}
	try {
		await setFlags(locals.user!, id, { nsfw, spoiler });
	} catch (e) {
		mapError(e);
	}
	return new Response(null, { status: 204 });
};
