import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../lib/server/db';
import { media } from '../../../../../lib/server/db/schema';
import { imageResponse } from '../../../../../lib/server/image-stream';
import { sniffMedia } from '../../../../../lib/server/media/process';
import { canSeeUnderReview, underReviewSql } from '../../../../../lib/server/moderation';
import { isPublicId } from '../../../../../lib/server/public-ids';
import { getObject } from '../../../../../lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * The original object of an image meme, streamed same-origin so a canvas can remix it. GIFs and
 * videos, unknown ids and memes hidden for review (unless the viewer may see those) are a 404.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	// The global guard already blocks anonymous requests; this keeps the route safe on its own.
	if (!locals.user) error(401, 'Unauthorized');
	// An invalid shape is a 404 without a query; a valid one is looked up by public id directly.
	if (!isPublicId(params.pid)) error(404, 'Not found');
	const [row] = await db
		.select({
			kind: media.kind,
			objectKey: media.objectKey,
			hidden: underReviewSql('meme', media.id, media.reviewedAt)
		})
		.from(media)
		.where(eq(media.publicId, params.pid));
	if (!row || row.kind !== 'image') error(404, 'Not found');
	if (row.hidden && !canSeeUnderReview(locals.user)) error(404, 'Not found');
	const { body, contentType } = await getObject(row.objectKey);
	const sniffed = await sniffMedia(body);
	return imageResponse(body, sniffed?.mime ?? contentType ?? 'application/octet-stream');
};
