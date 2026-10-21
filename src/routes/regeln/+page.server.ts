import { error, fail } from '@sveltejs/kit';
import {
	ContentPermissionError,
	getContent,
	MAX_CONTENT_LENGTH,
	saveContent
} from '../../lib/server/content';
import { TimeoutActiveError } from '../../lib/server/moderation';
import { timeoutFail } from '../../lib/server/moderation-http';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const content = await getContent('rules');
	const canEdit = locals.user?.role === 'admin';
	// the markdown source is only needed (and only sent) for the editor
	return { html: content.html, markdown: canEdit ? content.markdown : null, canEdit };
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Nicht angemeldet');
		const markdown = String((await request.formData()).get('markdown') ?? '');
		if (markdown.length > MAX_CONTENT_LENGTH) {
			return fail(400, { error: 'Der Text ist zu lang.', markdown });
		}
		try {
			await saveContent(locals.user, 'rules', markdown);
		} catch (e) {
			if (e instanceof ContentPermissionError) error(403, 'Nur Admins dürfen das bearbeiten');
			if (e instanceof TimeoutActiveError) return timeoutFail(e, { markdown });
			throw e;
		}
		return { saved: true };
	}
};
