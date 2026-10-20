import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/server/db';
import { media } from '../../../lib/server/db/schema';
import { listComments } from '../../../lib/server/comments';
import { getFeedItem } from '../../../lib/server/feed';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Meme nicht gefunden');
	const user = locals.user!;
	const [item, comments] = await Promise.all([getFeedItem(user.id, id), listComments(id)]);
	if (!item) error(404, 'Meme nicht gefunden');
	const canModerate = user.role === 'moderator' || user.role === 'admin';
	// Raw flags (the feed item only carries the merged blur state) and ownership for the manage menu.
	const [row] = await db
		.select({ uploaderId: media.uploaderId, nsfw: media.nsfw, spoiler: media.spoiler })
		.from(media)
		.where(eq(media.id, id));
	const canManage = row !== undefined && (row.uploaderId === user.id || canModerate);
	return {
		flags: canManage ? { nsfw: row.nsfw, spoiler: row.spoiler } : null,
		item,
		comments,
		viewer: { id: user.id, canModerate }
	};
};
