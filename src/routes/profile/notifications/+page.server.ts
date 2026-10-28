import { getPrefs, setPrefs } from '../../../lib/server/notifications';
import type { Actions, PageServerLoad } from './$types';

// The hooks already require a session for this path. These are delivery preferences only, so a
// muted member may save them and a save is not audited. The write lock applies (the path is not
// exempt).
export const load: PageServerLoad = async ({ locals }) => {
	return { prefs: await getPrefs(locals.user!.id) };
};

export const actions: Actions = {
	// `error` is never set here: the hook answers 503 (maintenance) or 429 (write budget) with it
	save: async ({ locals, request }): Promise<{ saved: boolean; error?: string }> => {
		const data = await request.formData();
		// An unchecked box sends nothing, so presence is the value.
		await setPrefs(locals.user!.id, {
			comments: data.has('comments'),
			threadComments: data.has('threadComments'),
			reportOutcomes: data.has('reportOutcomes')
		});
		return { saved: true };
	}
};
