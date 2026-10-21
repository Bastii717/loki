import { error, json } from '@sveltejs/kit';
import { toggleFavorite } from '../../../../../lib/server/memes';
import { mapModerationError } from '../../../../../lib/server/moderation-http';
import { MediaNotFoundError } from '../../../../../lib/server/votes';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const mediaId = Number(params.id);
	if (!Number.isSafeInteger(mediaId) || mediaId <= 0) error(404, 'Not found');
	try {
		return json(await toggleFavorite(locals.user!.id, mediaId));
	} catch (e) {
		if (e instanceof MediaNotFoundError) error(404, 'Not found');
		mapModerationError(e);
	}
};
