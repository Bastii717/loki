import { error, fail } from '@sveltejs/kit';
import { getFeedItem } from '../../lib/server/feed';
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
	// Placeholder: the follow-up slice stores the rendered file and posts the meme.
	stash: async () => fail(501, { error: 'Posting is not wired yet.' })
};
