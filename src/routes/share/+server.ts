import { redirect } from '@sveltejs/kit';
import { env } from '../../lib/server/env';
import { stashSharedFile } from '../../lib/server/share-stash';
import type { RequestHandler } from './$types';

/** PWA share target: parks the shared image/video server-side and hands over to /upload. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const form = await request.formData();
	const file = form.get('file');
	const usable =
		file instanceof File && file.size > 0 && file.size <= env.MAX_UPLOAD_MB * 1024 * 1024;
	if (!usable) redirect(303, '/upload');

	// The declared file.type is ignored: only bytes that sniff as allowed media are stashed.
	const stashed = await stashSharedFile(locals.user!.id, {
		name: file.name,
		data: Buffer.from(await file.arrayBuffer())
	});
	redirect(303, stashed ? '/upload?shared=1' : '/upload');
};
