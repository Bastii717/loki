import { error } from '@sveltejs/kit';
import {
	createReport,
	MAX_REPORT_TEXT,
	REPORT_CATEGORIES,
	type ContentType,
	type ReportCategory
} from '../../../lib/server/moderation';
import { mapModerationError } from '../../../lib/server/moderation-http';
import {
	isPublicId,
	resolveCommentId,
	resolveMediaId,
	resolveQuoteId
} from '../../../lib/server/public-ids';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: readonly ContentType[] = ['meme', 'comment', 'quote'];

/** Narrows raw client values at the boundary; nothing unchecked reaches the module. */
export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const { contentType, contentId, category, text } = (body ?? {}) as Record<string, unknown>;

	if (typeof contentType !== 'string' || !CONTENT_TYPES.includes(contentType as ContentType)) {
		error(400, 'contentType must be meme, comment or quote');
	}
	// the public id of the meme, comment or quote; a number (an internal id) is rejected like any other junk
	if (!isPublicId(contentId)) error(400, 'Invalid content ID.');
	if (typeof category !== 'string' || !REPORT_CATEGORIES.includes(category as ReportCategory)) {
		error(400, 'Invalid category');
	}
	if (text !== undefined && (typeof text !== 'string' || text.length > MAX_REPORT_TEXT)) {
		error(400, `text must be a string of at most ${MAX_REPORT_TEXT} characters`);
	}

	const resolve =
		contentType === 'meme'
			? resolveMediaId
			: contentType === 'comment'
				? resolveCommentId
				: resolveQuoteId;
	const id = await resolve(contentId);
	if (id === null) error(404, 'Not found');

	try {
		await createReport(
			locals.user!,
			contentType as ContentType,
			id,
			category as ReportCategory,
			text
		);
	} catch (e) {
		mapModerationError(e);
	}
	return new Response(null, { status: 204 });
};
