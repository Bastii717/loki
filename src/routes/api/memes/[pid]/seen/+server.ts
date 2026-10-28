import { error, json } from '@sveltejs/kit';
import { markSeen } from '../../../../../lib/server/comments';
import { resolveMediaId } from '../../../../../lib/server/public-ids';
import { MediaNotFoundError } from '../../../../../lib/server/votes';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const mediaId = await resolveMediaId(params.pid);
	if (mediaId === null) error(404, 'Not found');
	let counted: boolean;
	try {
		counted = await markSeen(locals.user!.id, mediaId);
	} catch (e) {
		if (e instanceof MediaNotFoundError) error(404, 'Not found');
		throw e;
	}
	// `counted` lets the detail view bump its visible counter only for a first view
	return json({ counted });
};
