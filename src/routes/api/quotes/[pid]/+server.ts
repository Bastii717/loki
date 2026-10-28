import { error } from '@sveltejs/kit';
import {
	deleteQuote,
	QuoteNotFoundError,
	QuotePermissionError
} from '../../../../lib/server/quotes';
import { mapModerationError } from '../../../../lib/server/moderation-http';
import { isPublicId, resolveQuoteId } from '../../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!isPublicId(params.pid)) error(404, 'Not found');
	const id = await resolveQuoteId(params.pid);
	if (id === null) error(404, 'Not found');
	try {
		await deleteQuote(locals.user!, id);
	} catch (e) {
		if (e instanceof QuoteNotFoundError) error(404, 'Not found');
		if (e instanceof QuotePermissionError) error(403, 'Forbidden');
		mapModerationError(e);
	}
	return new Response(null, { status: 204 });
};
