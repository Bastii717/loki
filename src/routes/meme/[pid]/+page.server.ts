import { canSeeUnderReview } from '../../../lib/server/moderation';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/server/db';
import { media } from '../../../lib/server/db/schema';
import { listComments } from '../../../lib/server/comments';
import { getFeedItem } from '../../../lib/server/feed';
import { isPublicId } from '../../../lib/server/public-ids';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	// An invalid shape never reaches the database.
	if (!isPublicId(params.pid)) error(404, 'Meme not found');
	const user = locals.user!;
	const canModerate = canSeeUnderReview(user);
	// Raw flags (the feed item only carries the merged blur state) and ownership for the manage menu;
	// the row also gives the internal id the comment list is keyed by.
	const [row] = await db
		.select({
			id: media.id,
			uploaderId: media.uploaderId,
			nsfw: media.nsfw,
			spoiler: media.spoiler
		})
		.from(media)
		.where(eq(media.publicId, params.pid));
	if (!row) error(404, 'Meme not found');
	const [item, comments] = await Promise.all([
		getFeedItem(user.id, canModerate, params.pid),
		listComments(row.id, canModerate)
	]);
	if (!item) error(404, 'Meme not found');
	const canManage = row.uploaderId === user.id || canModerate;
	return {
		flags: canManage ? { nsfw: row.nsfw, spoiler: row.spoiler } : null,
		item,
		comments,
		viewer: { id: user.publicId, canModerate }
	};
};
