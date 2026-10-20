import { error } from '@sveltejs/kit';
import { takeShared } from '../../../lib/server/share-stash';
import type { RequestHandler } from './$types';

/** Hands the stashed shared file to the upload page, once. */
export const GET: RequestHandler = ({ locals }) => {
	const file = takeShared(locals.user!.id);
	if (!file) error(404, 'Nichts geteilt');
	return new Response(new Uint8Array(file.data), {
		headers: {
			'content-type': file.type,
			'x-shared-name': encodeURIComponent(file.name),
			'cache-control': 'no-store'
		}
	});
};
