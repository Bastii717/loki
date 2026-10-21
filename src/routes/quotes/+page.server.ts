import { canSeeUnderReview } from '../../lib/server/moderation';
import { fail } from '@sveltejs/kit';
import {
	addQuote,
	listQuotes,
	MAX_AUTHOR_LENGTH,
	MAX_QUOTE_LENGTH,
	QuoteTextError
} from '../../lib/server/quotes';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	return {
		quotes: await listQuotes(user.id, canSeeUnderReview(user)),
		canModerate: canSeeUnderReview(user),
		limits: { text: MAX_QUOTE_LENGTH, author: MAX_AUTHOR_LENGTH }
	};
};

export const actions: Actions = {
	// Submit is a form action (works without JS, enhanced client-side).
	add: async ({ request, locals }) => {
		const form = await request.formData();
		const text = String(form.get('text') ?? '');
		const author = String(form.get('author') ?? '');
		try {
			await addQuote(locals.user!.id, text, author);
		} catch (e) {
			if (e instanceof QuoteTextError) {
				return fail(400, { error: 'Bitte Zitat und Urheber ausfüllen.', text, author });
			}
			throw e;
		}
		return { success: true };
	}
};
