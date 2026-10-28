import { error, json } from '@sveltejs/kit';
import { QuoteNotFoundError, voteQuote } from '../../../../../lib/server/quotes';
import { mapModerationError } from '../../../../../lib/server/moderation-http';
import { isPublicId, resolveQuoteId } from '../../../../../lib/server/public-ids';
import type { VoteValue } from '../../../../../lib/server/votes';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!isPublicId(params.pid)) error(404, 'Not found');
	const id = await resolveQuoteId(params.pid);
	if (id === null) error(404, 'Not found');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const value = (body as { value?: unknown } | null)?.value;
	if (value !== 1 && value !== -1 && value !== 0) error(400, 'value must be 1, -1 or 0');

	try {
		return json(await voteQuote(locals.user!.id, id, value as VoteValue));
	} catch (e) {
		if (e instanceof QuoteNotFoundError) error(404, 'Not found');
		mapModerationError(e);
	}
};
