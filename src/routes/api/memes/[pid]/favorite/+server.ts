import { error, json } from '@sveltejs/kit';
import { toggleFavorite } from '../../../../../lib/server/memes';
import { mapModerationError } from '../../../../../lib/server/moderation-http';
import { resolveMediaId } from '../../../../../lib/server/public-ids';
import { MediaNotFoundError } from '../../../../../lib/server/votes';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const mediaId = await resolveMediaId(params.pid);
	if (mediaId === null) error(404, 'Not found');
	try {
		return json(await toggleFavorite(locals.user!.id, mediaId));
	} catch (e) {
		if (e instanceof MediaNotFoundError) error(404, 'Not found');
		mapModerationError(e);
	}
};
