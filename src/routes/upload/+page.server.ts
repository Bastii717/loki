import { fail, redirect } from '@sveltejs/kit';
import { env } from '../../lib/server/env';
import { TimeoutActiveError } from '../../lib/server/moderation';
import { timeoutFail } from '../../lib/server/moderation-http';
import { UploadError, createMedia, parseTemplateId } from '../../lib/server/media/create';
import { peekShared } from '../../lib/server/share-stash';
import type { Actions, PageServerLoad } from './$types';

const TITLE_MAX = 150;

/** `?shared=1` after the PWA share target: tells the page a file is waiting in the stash. */
export const load: PageServerLoad = ({ url, locals }) => ({
	hasShared: url.searchParams.get('shared') === '1' && peekShared(locals.user!.id) !== null
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '')
			.trim()
			.slice(0, TITLE_MAX);
		const tagNames = form.getAll('tag').map(String);
		const nsfw = form.get('nsfw') === 'on';
		const spoiler = form.get('spoiler') === 'on';
		const values = { title, nsfw, spoiler };

		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { ...values, message: 'Pick a file first' });
		}

		// provenance from the generator hand-over; an unknown or removed template is ignored
		const templateId = await parseTemplateId(form.get('templateId'));

		try {
			await createMedia({
				uploader: locals.user!,
				file: Buffer.from(await file.arrayBuffer()),
				title,
				tagNames,
				nsfw,
				spoiler,
				templateId
			});
		} catch (e) {
			if (e instanceof TimeoutActiveError) return timeoutFail(e, values);
			if (e instanceof UploadError) {
				const message =
					e.code === 'size'
						? `File is too large (max ${env.MAX_UPLOAD_MB} MB)`
						: 'Unsupported file type';
				return fail(e.code === 'size' ? 413 : 415, { ...values, message });
			}
			// never surface internal error text (ffmpeg/sharp/S3 can leak paths)
			console.error('upload failed', e);
			return fail(500, { ...values, message: 'Upload failed' });
		}
		redirect(303, '/');
	}
};
