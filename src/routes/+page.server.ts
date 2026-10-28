import { eq } from 'drizzle-orm';
import { db } from '../lib/server/db';
import { users } from '../lib/server/db/schema';
import { canSeeUnderReview } from '../lib/server/moderation';
import { getFeedPage, parseSort, parseTag } from '../lib/server/feed';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;
	const sort = parseSort(url.searchParams.get('sort'));
	const tag = parseTag(url.searchParams.get('tag'));
	const [{ items, nextCursor }, [avatar]] = await Promise.all([
		getFeedPage({ viewerId: user.id, revealAll: canSeeUnderReview(user), sort, tag }),
		// the header's profile button shows the viewer's picture (one primary-key read)
		db
			.select({ key: users.avatarKey, thumbKey: users.avatarThumbKey })
			.from(users)
			.where(eq(users.id, user.id))
	]);
	return { sort, tag: tag ?? null, items, nextCursor, avatar: avatar ?? null };
};
