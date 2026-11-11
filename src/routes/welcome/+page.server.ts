import { error, fail, redirect } from '@sveltejs/kit';
import { acceptRules, getContent, needsRulesAcceptance } from '../../lib/server/content';
import type { Actions, PageServerLoad } from './$types';

/**
 * The house-rules interstitial. The hook sends members here (and refuses their writes) until they
 * accept the current rules; anybody who has nothing to accept is sent on to the feed.
 * `changed` is true when they accepted an earlier version.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	if (!(await needsRulesAcceptance(locals.user))) redirect(303, '/');
	return {
		html: (await getContent('rules')).html,
		changed: locals.user.rulesAcceptedAt !== null
	};
};

export const actions: Actions = {
	accept: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		// the checkbox gates the button client-side; the server checks it too (works without JS)
		if ((await request.formData()).get('agree') !== 'on') {
			return fail(400, { error: 'Please confirm that you have read the house rules.' });
		}
		await acceptRules(locals.user.id);
		redirect(303, '/');
	}
};
