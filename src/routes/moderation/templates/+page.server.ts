import { fail } from '@sveltejs/kit';
import type { SessionUser } from '../../../lib/server/auth/session';
import { requireModerator } from '../../../lib/server/moderation-guard';
import {
	addTemplate,
	listTemplates,
	removeTemplate,
	renameTemplate,
	restoreTemplate,
	TemplateError,
	templateErrorMessage
} from '../../../lib/server/templates';
import type { Actions, PageServerLoad } from './$types';

const NOT_FOUND = 'Template not found.';

export const load: PageServerLoad = async ({ locals }) => {
	await requireModerator(locals.user, 'admin');
	const all = await listTemplates({ includeRemoved: true });
	return {
		templates: all.filter((t) => !t.removedAt),
		removed: all.filter((t) => t.removedAt)
	};
};

/** A positive integer id from the form, or null. */
function parseId(value: FormDataEntryValue | null): number | null {
	if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Runs a module call and maps its rejection to a form failure; anything else is a real error. */
async function guarded(work: () => Promise<unknown>) {
	try {
		await work();
	} catch (e) {
		if (e instanceof TemplateError) {
			return fail(e.code === 'notfound' ? 404 : 400, { error: templateErrorMessage(e) });
		}
		throw e;
	}
	return { ok: true as const };
}

/** An action on one existing template, addressed by the `id` field. */
const onTemplate =
	(work: (actor: SessionUser, id: number, data: FormData) => Promise<unknown>) =>
	async ({ locals, request }: { locals: App.Locals; request: Request }) => {
		const actor = await requireModerator(locals.user, 'admin');
		const data = await request.formData();
		const id = parseId(data.get('id'));
		if (id === null) return fail(404, { error: NOT_FOUND });
		return guarded(() => work(actor, id, data));
	};

export const actions: Actions = {
	add: async ({ locals, request }) => {
		const actor = await requireModerator(locals.user, 'admin');
		const data = await request.formData();
		const file = data.get('file');
		// A browser sends an empty file part when none was chosen.
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Pick an image first.' });
		}
		const name = String(data.get('name') ?? '');
		return guarded(async () => addTemplate(actor, name, Buffer.from(await file.arrayBuffer())));
	},

	rename: onTemplate((actor, id, data) =>
		renameTemplate(actor, id, String(data.get('name') ?? ''))
	),

	remove: onTemplate((actor, id) => removeTemplate(actor, id)),

	restore: onTemplate((actor, id) => restoreTemplate(actor, id))
};
