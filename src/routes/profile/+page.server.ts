import { eq, sql } from 'drizzle-orm';
import { db } from '../../lib/server/db';
import { comments, favorites, media } from '../../lib/server/db/schema';
import { getProfile, nextRenameAt } from '../../lib/server/profile';
import type { PageServerLoad } from './$types';

const n = sql<number>`count(*)::int`;

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const [[memes], [favs], [comms], profile] = await Promise.all([
		db.select({ n }).from(media).where(eq(media.uploaderId, user.id)),
		db.select({ n }).from(favorites).where(eq(favorites.userId, user.id)),
		db.select({ n }).from(comments).where(eq(comments.authorId, user.id)),
		getProfile(user.id)
	]);
	return {
		profile: {
			username: profile.username,
			displayName: profile.displayName,
			motto: profile.motto,
			avatarKey: profile.avatarKey,
			avatarThumbKey: profile.avatarThumbKey,
			role: profile.role
		},
		nextRenameAt: nextRenameAt(profile.displayNameChangedAt, new Date())?.toISOString() ?? null,
		counts: { memes: memes.n, favorites: favs.n, comments: comms.n }
	};
};
