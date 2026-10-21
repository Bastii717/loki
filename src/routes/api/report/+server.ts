import { error } from '@sveltejs/kit';
import {
	createReport,
	MAX_REPORT_TEXT,
	REPORT_CATEGORIES,
	type ContentType,
	type ReportCategory
} from '../../../lib/server/moderation';
import { mapModerationError } from '../../../lib/server/moderation-http';
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
	if (typeof contentId !== 'number' || !Number.isSafeInteger(contentId) || contentId <= 0) {
		error(400, 'contentId must be a positive integer');
	}
	if (typeof category !== 'string' || !REPORT_CATEGORIES.includes(category as ReportCategory)) {
		error(400, 'Invalid category');
	}
	if (text !== undefined && (typeof text !== 'string' || text.length > MAX_REPORT_TEXT)) {
		error(400, `text must be a string of at most ${MAX_REPORT_TEXT} characters`);
	}

	try {
		await createReport(
			locals.user!,
			contentType as ContentType,
			contentId,
			category as ReportCategory,
			text
		);
	} catch (e) {
		mapModerationError(e);
	}
	return new Response(null, { status: 204 });
};
