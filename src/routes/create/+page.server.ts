import { error, fail, redirect } from '@sveltejs/kit';
import { env } from '../../lib/server/env';
import { getFeedItem } from '../../lib/server/feed';
import { parseTemplateId } from '../../lib/server/media/create';
import { sniffMedia } from '../../lib/server/media/process';
import { stashSharedFile } from '../../lib/server/share-stash';
import { canSeeUnderReview } from '../../lib/server/moderation';
import { getTemplate, listTemplates, type TemplateRow } from '../../lib/server/templates';
import type { Actions, PageServerLoad } from './$types';

/** Fallback size for a meme row without stored dimensions. */
const FALLBACK = { width: 1200, height: 900 };

export interface EditorSource {
	kind: 'template' | 'meme';
	id: number;
	name: string;
	width: number;
	height: number;
	/** Same-origin URL the editor draws from. */
	url: string;
}

export type CreateData =
	{ mode: 'grid'; templates: TemplateRow[] } | { mode: 'template' | 'meme'; source: EditorSource };

/** A positive integer from user input, else null. */
function parseId(raw: string | null): number | null {
	if (raw === null || !/^\d{1,9}$/.test(raw)) return null;
	const n = Number(raw);
	return n > 0 ? n : null;
}

// The hooks already require a session for this path, so there is no guard of its own.
export const load: PageServerLoad = async ({ locals, url }): Promise<CreateData> => {
	const user = locals.user!;
	const templateId = parseId(url.searchParams.get('template'));
	const memeId = parseId(url.searchParams.get('meme'));

	if (templateId !== null) {
		const template = await getTemplate(templateId);
		if (!template) error(404, 'Template not found.');
		return {
			mode: 'template',
			source: {
				kind: 'template',
				id: template.id,
				name: template.name,
				width: template.width,
				height: template.height,
				url: `/api/templates/${template.id}/image`
			}
		};
	}

	if (memeId !== null) {
		const revealAll = canSeeUnderReview(user);
		const item = await getFeedItem(user.id, memeId, revealAll);
		if (!item || item.kind !== 'image' || (item.underReview && !revealAll)) {
			error(404, 'Meme not found.');
		}
		return {
			mode: 'meme',
			source: {
				kind: 'meme',
				id: item.id,
				name: item.title || 'Untitled',
				width: item.width ?? FALLBACK.width,
				height: item.height ?? FALLBACK.height,
				url: `/api/memes/${item.id}/source`
			}
		};
	}

	return { mode: 'grid', templates: await listTemplates() };
};

export const actions: Actions = {
	// Parks the rendered PNG for the upload form (which posts it); never creates a meme itself.
	stash: async ({ request, locals }) => {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Nothing to post yet.' });
		}
		if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) {
			return fail(413, { error: `File is too large (max ${env.MAX_UPLOAD_MB} MB)` });
		}
		const data = Buffer.from(await file.arrayBuffer());
		if ((await sniffMedia(data))?.mime !== 'image/png') {
			return fail(415, { error: 'Unsupported file type' });
		}

		const requested = parseTemplateId(form.get('templateId'));
		// a removed or unknown template is dropped silently: the meme still posts
		const templateId =
			requested !== undefined && (await getTemplate(requested)) ? requested : undefined;
		const stashed = await stashSharedFile(locals.user!.id, {
			name: 'meme.png',
			data,
			title: String(form.get('title') ?? ''),
			templateId
		});
		if (!stashed) return fail(415, { error: 'Unsupported file type' });
		redirect(303, '/upload?shared=1');
	}
};
