import { and, eq, sql } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { favorites, media } from './db/schema';
import {
	AUDIT_ACTIONS,
	assertNotTimedOut,
	resolveAfterDelete,
	resolveCommentReportsOfMedia,
	resolveWithAudit,
	snapshotContent
} from './moderation';
import { deleteObjects } from './storage';
import { MediaNotFoundError } from './votes';

export class MediaPermissionError extends Error {
	constructor() {
		super('Not allowed to modify this media');
	}
}

const isModerator = (user: SessionUser) => user.role === 'moderator' || user.role === 'admin';

/** Adds or removes the user's favorite and returns the new state with the total count. */
export async function toggleFavorite(
	userId: number,
	mediaId: number
): Promise<{ favorited: boolean; count: number }> {
	await assertNotTimedOut({ id: userId });
	return db.transaction(async (tx) => {
		// Lock the media row so concurrent toggles on one meme serialize.
		const [row] = await tx
			.select({ id: media.id })
			.from(media)
			.where(eq(media.id, mediaId))
			.for('update');
		if (!row) throw new MediaNotFoundError();

		const removed = await tx
			.delete(favorites)
			.where(and(eq(favorites.userId, userId), eq(favorites.mediaId, mediaId)))
			.returning({ userId: favorites.userId });
		const favorited = removed.length === 0;
		if (favorited) await tx.insert(favorites).values({ userId, mediaId });

		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)::int` })
			.from(favorites)
			.where(eq(favorites.mediaId, mediaId));
		return { favorited, count };
	});
}

/**
 * Uploader or moderator/admin. Removes the row (dependents cascade) and closes its open reports in
 * one transaction (the uploader's own deletion: 'removed', no audit; a moderator's: always an audit
 * row with author + title, and the open reports 'actioned'),
 * then removes both bucket objects. Objects that are already gone are no error (S3 deletes are idempotent).
 */
export async function deleteMedia(user: SessionUser, mediaId: number): Promise<void> {
	const [row] = await db
		.select({ uploaderId: media.uploaderId, objectKey: media.objectKey, thumbKey: media.thumbKey })
		.from(media)
		.where(eq(media.id, mediaId));
	if (!row) throw new MediaNotFoundError();
	if (row.uploaderId !== user.id && !isModerator(user)) throw new MediaPermissionError();
	// Deleting one's own meme stays allowed while timed out; acting on others' is moderation, which a timeout suspends.
	if (row.uploaderId !== user.id) await assertNotTimedOut(user);

	await db.transaction(async (tx) => {
		// the meme's comments cascade away with it: close their reports (neutrally) first
		await resolveCommentReportsOfMedia(user, mediaId, tx);
		const snapshot = await snapshotContent(tx, 'meme', mediaId);
		await tx.delete(media).where(eq(media.id, mediaId));
		await resolveAfterDelete(user, 'meme', mediaId, row.uploaderId, tx, snapshot);
	});
	await deleteObjects([row.objectKey, row.thumbKey]);
}

/**
 * Moderators/admins on any media, the uploader on their own. Unspecified flags stay unchanged.
 * Every change of a flag on someone else's meme is audited with its direction ("NSFW an", "Spoiler
 * aus"): flags_forced when a flag is switched ON (which also closes the open reports as
 * 'actioned'), flags_changed when flags are only switched off. Own memes are never audited.
 */
export async function setFlags(
	user: SessionUser,
	mediaId: number,
	flags: { nsfw?: boolean; spoiler?: boolean }
): Promise<void> {
	const [row] = await db
		.select({ uploaderId: media.uploaderId, nsfw: media.nsfw, spoiler: media.spoiler })
		.from(media)
		.where(eq(media.id, mediaId));
	if (!row) throw new MediaNotFoundError();
	if (row.uploaderId !== user.id && !isModerator(user)) throw new MediaPermissionError();
	// Own flags are a user write, flags on others' memes are moderation: both are blocked by a timeout.
	await assertNotTimedOut(user);

	const set: { nsfw?: boolean; spoiler?: boolean } = {};
	if (flags.nsfw !== undefined) set.nsfw = flags.nsfw;
	if (flags.spoiler !== undefined) set.spoiler = flags.spoiler;
	if (Object.keys(set).length === 0) return;
	const foreign = row.uploaderId !== user.id;
	const forced = foreign && (set.nsfw === true || set.spoiler === true);
	// switching off a flag that is off already changes nothing: nothing to audit
	const changed =
		(set.nsfw !== undefined && set.nsfw !== row.nsfw) ||
		(set.spoiler !== undefined && set.spoiler !== row.spoiler);
	// the audit detail names every requested flag with its direction ("NSFW on, Spoiler off")
	const what = [
		set.nsfw !== undefined && `NSFW ${set.nsfw ? 'on' : 'off'}`,
		set.spoiler !== undefined && `Spoiler ${set.spoiler ? 'on' : 'off'}`
	]
		.filter(Boolean)
		.join(', ');
	await db.transaction(async (tx) => {
		await tx.update(media).set(set).where(eq(media.id, mediaId));
		if (forced || (foreign && changed)) {
			await resolveWithAudit(
				user,
				'meme',
				mediaId,
				forced ? AUDIT_ACTIONS.flagsForced : AUDIT_ACTIONS.flagsChanged,
				`${what}, `,
				tx
			);
		}
	});
}
