import { error } from '@sveltejs/kit';
import { and, eq, not, sql } from 'drizzle-orm';
import { awardsOf } from '../../../lib/server/awards';
import { db } from '../../../lib/server/db';
import { media, users } from '../../../lib/server/db/schema';
import { getFeedPage } from '../../../lib/server/feed';
import { canSeeUnderReview, underReviewSql } from '../../../lib/server/moderation';
import { getProfile, ProfileInputError } from '../../../lib/server/profile';
import { isPublicId, resolveUserId } from '../../../lib/server/public-ids';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const viewer = locals.user!;
	// an invalid shape never reaches the database
	if (!isPublicId(params.pid)) error(404, 'No such member.');
	const id = await resolveUserId(params.pid);
	if (id === null) error(404, 'No such member.');

	const revealAll = canSeeUnderReview(viewer);
	const profile = await getProfile(id).catch((e: unknown) => {
		if (e instanceof ProfileInputError) error(404, 'No such member.');
		throw e;
	});

	const [[since], [count], page, awards] = await Promise.all([
		db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, id)),
		// same rule as the list: members never count (or see) memes hidden for review
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(media)
			.where(
				and(
					eq(media.uploaderId, id),
					revealAll ? undefined : not(underReviewSql('meme', media.id, media.reviewedAt))
				)
			),
		getFeedPage({
			viewerId: viewer.id,
			revealAll,
			sort: 'new',
			filter: { uploaderId: id, hideUnderReview: !revealAll }
		}),
		awardsOf(id)
	]);

	return {
		member: {
			id: params.pid,
			name: profile.displayName ?? profile.username,
			// the login name stays private to moderators, like in the rest of the app
			username: revealAll ? profile.username : null,
			role: profile.role,
			avatarKey: profile.avatarKey,
			avatarThumbKey: profile.avatarThumbKey,
			motto: profile.motto,
			memberSince: since.createdAt.toISOString()
		},
		memeCount: count.n,
		awards,
		items: page.items,
		nextCursor: page.nextCursor
	};
};
