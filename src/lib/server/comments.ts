import { desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { comments, media, mediaViews, users } from './db/schema';
import {
	assertNotTimedOut,
	resolveAfterDelete,
	snapshotContent,
	underReviewSql
} from './moderation';
import { commentExcerpt, notify } from './notifications';
import type { SessionUser } from './auth/session';
import { MediaNotFoundError } from './votes';

export const MAX_COMMENT_LENGTH = 2000;

export class CommentTextError extends Error {
	constructor() {
		super(`Comment must be 1-${MAX_COMMENT_LENGTH} characters`);
	}
}
export class CommentNotFoundError extends Error {
	constructor() {
		super('Comment not found');
	}
}
export class CommentPermissionError extends Error {
	constructor() {
		super('Not allowed to delete this comment');
	}
}

export interface CommentItem {
	id: number;
	mediaId: number;
	authorId: number;
	/** Display name when set, else the username. */
	author: string;
	authorRole: 'member' | 'moderator' | 'admin';
	/** Thumb key of the author's avatar, null when they have none. */
	authorAvatar: string | null;
	/** null while under review, for viewers who may not see it. */
	text: string | null;
	underReview: boolean;
	createdAt: string;
}

const columns = {
	id: comments.id,
	mediaId: comments.mediaId,
	authorId: comments.authorId,
	author: sql<string>`coalesce(${users.displayName}, ${users.username})`,
	authorRole: users.role,
	authorAvatar: users.avatarThumbKey,
	text: comments.text,
	underReview: underReviewSql('comment', comments.id, comments.reviewedAt),
	createdAt: comments.createdAt
};

const toItem = (r: Omit<CommentItem, 'createdAt'> & { createdAt: Date }): CommentItem => ({
	...r,
	createdAt: r.createdAt.toISOString()
});

/** Comments of a meme, newest first. Under-review texts are nulled unless `revealAll` (moderators). */
export async function listComments(mediaId: number, revealAll = false): Promise<CommentItem[]> {
	const rows = await db
		.select(columns)
		.from(comments)
		.innerJoin(users, eq(users.id, comments.authorId))
		.where(eq(comments.mediaId, mediaId))
		.orderBy(desc(comments.createdAt), desc(comments.id));
	return rows.map((r) => {
		const item = toItem(r);
		return item.underReview && !revealAll ? { ...item, text: null } : item;
	});
}

export async function addComment(
	userId: number,
	mediaId: number,
	text: string
): Promise<CommentItem> {
	const trimmed = text.trim();
	if (trimmed.length < 1 || trimmed.length > MAX_COMMENT_LENGTH) throw new CommentTextError();
	await assertNotTimedOut({ id: userId });
	const [m] = await db
		.select({ id: media.id, uploaderId: media.uploaderId })
		.from(media)
		.where(eq(media.id, mediaId));
	if (!m) throw new MediaNotFoundError();
	return db.transaction(async (tx) => {
		// earlier commenters are read before the insert, so the new comment never counts as one
		const earlier = await tx
			.selectDistinct({ authorId: comments.authorId })
			.from(comments)
			.where(eq(comments.mediaId, mediaId))
			// a fixed order keeps the per-recipient locks in notify from deadlocking two concurrent comments
			.orderBy(comments.authorId);
		const [inserted] = await tx
			.insert(comments)
			.values({ mediaId, authorId: userId, text: trimmed })
			.returning({ id: comments.id });

		const base = {
			actorId: userId,
			contentType: 'comment',
			contentId: inserted.id,
			mediaId,
			detail: commentExcerpt(trimmed)
		} as const;
		await notify(tx, { ...base, userId: m.uploaderId, kind: 'comment' });
		for (const { authorId } of earlier) {
			// the uploader got `comment` above; the author never hears about their own comment (notify skips them)
			if (authorId === m.uploaderId) continue;
			await notify(tx, { ...base, userId: authorId, kind: 'thread_comment' });
		}

		const [row] = await tx
			.select(columns)
			.from(comments)
			.innerJoin(users, eq(users.id, comments.authorId))
			.where(eq(comments.id, inserted.id));
		return toItem(row);
	});
}

/**
 * Author, moderator or admin may delete; everyone else gets CommentPermissionError. Closes the
 * comment's open reports in the same transaction (author: 'removed', no audit; moderator: always an audit row, reports 'actioned').
 */
export async function deleteComment(user: SessionUser, commentId: number): Promise<void> {
	const [c] = await db
		.select({ authorId: comments.authorId, mediaId: comments.mediaId })
		.from(comments)
		.where(eq(comments.id, commentId));
	if (!c) throw new CommentNotFoundError();
	if (c.authorId !== user.id && user.role !== 'moderator' && user.role !== 'admin') {
		throw new CommentPermissionError();
	}
	// Own comments may always be removed; moderating others' is suspended by a timeout.
	if (c.authorId !== user.id) await assertNotTimedOut(user);
	await db.transaction(async (tx) => {
		const snapshot = await snapshotContent(tx, 'comment', commentId);
		await tx.delete(comments).where(eq(comments.id, commentId));
		await resolveAfterDelete(user, 'comment', commentId, c.authorId, tx, snapshot, c.mediaId);
	});
}

/**
 * Records that the user has seen a meme. The single seen-write (detail view and
 * Discover): inserts the mediaViews row and bumps media.viewCount only when the
 * row was new, in one transaction, so repeats and races never double-count.
 * Returns whether this call counted a new view.
 */
export async function markSeen(userId: number, mediaId: number): Promise<boolean> {
	const [m] = await db.select({ id: media.id }).from(media).where(eq(media.id, mediaId));
	if (!m) throw new MediaNotFoundError();
	return db.transaction(async (tx) => {
		const inserted = await tx
			.insert(mediaViews)
			.values({ userId, mediaId })
			.onConflictDoNothing()
			.returning({ userId: mediaViews.userId });
		if (inserted.length > 0) {
			await tx
				.update(media)
				.set({ viewCount: sql`${media.viewCount} + 1` })
				.where(eq(media.id, mediaId));
		}
		return inserted.length > 0;
	});
}
