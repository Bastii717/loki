import { redirect } from '@sveltejs/kit';
import { env } from '../../lib/server/env';
import { putShared } from '../../lib/server/share-stash';
import type { RequestHandler } from './$types';

/** PWA share target: parks the shared image/video server-side and hands over to /upload. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const form = await request.formData();
	const file = form.get('file');
	const usable =
		file instanceof File &&
		file.size > 0 &&
		file.size <= env.MAX_UPLOAD_MB * 1024 * 1024 &&
		/^(image|video)\//.test(file.type);
	if (!usable) redirect(303, '/upload');

	putShared(locals.user!.id, {
		name: file.name,
		type: file.type,
		data: Buffer.from(await file.arrayBuffer())
	});
	redirect(303, '/upload?shared=1');
};
