import { fail, redirect } from '@sveltejs/kit';
import { env } from '../../lib/server/env';
import { UploadError, createMedia } from '../../lib/server/media/create';
import type { Actions } from './$types';

const TITLE_MAX = 150;

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
			return fail(400, { ...values, message: 'Bitte wähle eine Datei aus' });
		}

		try {
			await createMedia({
				uploader: locals.user!,
				file: Buffer.from(await file.arrayBuffer()),
				title,
				tagNames,
				nsfw,
				spoiler
			});
		} catch (e) {
			if (e instanceof UploadError) {
				const message =
					e.code === 'size'
						? `Datei zu groß (max. ${env.MAX_UPLOAD_MB} MB)`
						: 'Dateityp wird nicht unterstützt';
				return fail(e.code === 'size' ? 413 : 415, { ...values, message });
			}
			// never surface internal error text (ffmpeg/sharp/S3 can leak paths)
			console.error('upload failed', e);
			return fail(500, { ...values, message: 'Upload fehlgeschlagen' });
		}
		redirect(303, '/');
	}
};
