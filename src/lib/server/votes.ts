import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { media, votes } from './db/schema';

export type VoteValue = 1 | -1 | 0;

export class MediaNotFoundError extends Error {
	constructor() {
		super('Media not found');
	}
}

/**
 * Sets the user's vote on a meme (0 clears it) and adjusts the cached
 * media.score by the delta, all in one transaction. The media row is locked
 * (FOR UPDATE) so concurrent votes on the same meme serialize and the cached
 * score never drifts from the sum of the votes rows.
 */
export async function applyVote(
	userId: number,
	mediaId: number,
	value: VoteValue
): Promise<{ score: number; userVote: VoteValue }> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ id: media.id })
			.from(media)
			.where(eq(media.id, mediaId))
			.for('update');
		if (!row) throw new MediaNotFoundError();

		const [existing] = await tx
			.select({ value: votes.value })
			.from(votes)
			.where(and(eq(votes.userId, userId), eq(votes.mediaId, mediaId)));
		const previous = existing?.value ?? 0;

		if (value === 0) {
			if (existing) {
				await tx.delete(votes).where(and(eq(votes.userId, userId), eq(votes.mediaId, mediaId)));
			}
		} else {
			await tx
				.insert(votes)
				.values({ userId, mediaId, value })
				.onConflictDoUpdate({ target: [votes.userId, votes.mediaId], set: { value } });
		}

		const [updated] = await tx
			.update(media)
			.set({ score: sql`${media.score} + ${value - previous}` })
			.where(eq(media.id, mediaId))
			.returning({ score: media.score });
		return { score: updated.score, userVote: value };
	});
}
