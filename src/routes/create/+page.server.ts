import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '../../lib/server/auth/session';
import { db } from '../../lib/server/db';
import { media } from '../../lib/server/db/schema';
import { env } from '../../lib/server/env';
import { getFeedItem } from '../../lib/server/feed';
import { sniffMedia } from '../../lib/server/media/process';
import { isPublicId, resolveMediaId } from '../../lib/server/public-ids';
import { stashSharedFile } from '../../lib/server/share-stash';
import { canSeeUnderReview } from '../../lib/server/moderation';
import { getTemplate, listTemplates, type TemplateRow } from '../../lib/server/templates';
import type { Actions, PageServerLoad } from './$types';

/** Fallback size for a meme row without stored dimensions. */
const FALLBACK = { width: 1200, height: 900 };

export interface EditorSource {
	kind: 'template' | 'meme';
	/** Public id of the template or meme. */
	id: string;
	name: string;
	width: number;
	height: number;
	/** Same-origin URL the editor draws from. */
	url: string;
}

export type CreateData =
	{ mode: 'grid'; templates: TemplateRow[] } | { mode: 'template' | 'meme'; source: EditorSource };

/** An image meme the viewer may see (same rule as the editor load), else null. */
async function visibleImageMeme(user: SessionUser, pid: string) {
	const id = await resolveMediaId(pid);
	if (id === null) return null;
	const revealAll = canSeeUnderReview(user);
	// TODO(public-ids slice A): switch to getFeedItemById
	const item = await getFeedItem(user.id, id, revealAll);
	if (!item || item.kind !== 'image' || (item.underReview && !revealAll)) return null;
	return { item, id };
}

/** The stored NSFW/spoiler flags of a remix source; none when it is unknown, not an image or hidden. */
async function sourceFlags(
	user: SessionUser,
	raw: FormDataEntryValue | null
): Promise<{ nsfw?: boolean; spoiler?: boolean }> {
	const visible = isPublicId(raw) ? await visibleImageMeme(user, raw) : null;
	if (!visible) return {};
	const [row] = await db
		.select({ nsfw: media.nsfw, spoiler: media.spoiler })
		.from(media)
		.where(eq(media.id, visible.id));
	return row ? { nsfw: row.nsfw, spoiler: row.spoiler } : {};
}

// The hooks already require a session for this path, so there is no guard of its own.
export const load: PageServerLoad = async ({ locals, url }): Promise<CreateData> => {
	const user = locals.user!;
	const templateParam = url.searchParams.get('template');
	const memeParam = url.searchParams.get('meme');

	if (templateParam !== null) {
		const template = isPublicId(templateParam) ? await getTemplate(templateParam) : null;
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

	if (memeParam !== null) {
		const visible = isPublicId(memeParam) ? await visibleImageMeme(user, memeParam) : null;
		if (!visible) error(404, 'Meme not found.');
		const { item } = visible;
		return {
			mode: 'meme',
			source: {
				kind: 'meme',
				id: memeParam,
				name: item.title || 'Untitled',
				width: item.width ?? FALLBACK.width,
				height: item.height ?? FALLBACK.height,
				url: `/api/memes/${memeParam}/source`
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

		const requested = form.get('templateId');
		// an unknown, malformed or removed template is dropped silently: the meme still posts
		const templateId =
			isPublicId(requested) && (await getTemplate(requested)) ? requested : undefined;
		// a remix keeps the source meme's flags, looked up here and never taken from the client
		const flags = await sourceFlags(locals.user!, form.get('sourceMemeId'));
		const stashed = await stashSharedFile(locals.user!.id, {
			name: 'meme.png',
			data,
			title: String(form.get('title') ?? ''),
			templateId,
			...flags
		});
		if (!stashed) return fail(415, { error: 'Unsupported file type' });
		redirect(303, '/upload?shared=1');
	}
};
