import { error } from '@sveltejs/kit';
import { listComments } from '../../../lib/server/comments';
import { getFeedItem } from '../../../lib/server/feed';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Meme nicht gefunden');
	const user = locals.user!;
	const [item, comments] = await Promise.all([getFeedItem(user.id, id), listComments(id)]);
	if (!item) error(404, 'Meme nicht gefunden');
	return {
		item,
		comments,
		viewer: { id: user.id, canModerate: user.role === 'moderator' || user.role === 'admin' }
	};
};
