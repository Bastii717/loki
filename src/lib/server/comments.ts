import { desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { comments, media, mediaViews, users } from './db/schema';
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
	author: string;
	text: string;
	createdAt: string;
}

const columns = {
	id: comments.id,
	mediaId: comments.mediaId,
	authorId: comments.authorId,
	author: users.username,
	text: comments.text,
	createdAt: comments.createdAt
};

const toItem = (r: Omit<CommentItem, 'createdAt'> & { createdAt: Date }): CommentItem => ({
	...r,
	createdAt: r.createdAt.toISOString()
});

/** Comments of a meme, newest first. */
export async function listComments(mediaId: number): Promise<CommentItem[]> {
	const rows = await db
		.select(columns)
		.from(comments)
		.innerJoin(users, eq(users.id, comments.authorId))
		.where(eq(comments.mediaId, mediaId))
		.orderBy(desc(comments.createdAt), desc(comments.id));
	return rows.map(toItem);
}

export async function addComment(
	userId: number,
	mediaId: number,
	text: string
): Promise<CommentItem> {
	const trimmed = text.trim();
	if (trimmed.length < 1 || trimmed.length > MAX_COMMENT_LENGTH) throw new CommentTextError();
	const [m] = await db.select({ id: media.id }).from(media).where(eq(media.id, mediaId));
	if (!m) throw new MediaNotFoundError();
	const [inserted] = await db
		.insert(comments)
		.values({ mediaId, authorId: userId, text: trimmed })
		.returning({ id: comments.id });
	const [row] = await db
		.select(columns)
		.from(comments)
		.innerJoin(users, eq(users.id, comments.authorId))
		.where(eq(comments.id, inserted.id));
	return toItem(row);
}

/** Author, moderator or admin may delete; everyone else gets CommentPermissionError. */
export async function deleteComment(user: SessionUser, commentId: number): Promise<void> {
	const [c] = await db
		.select({ authorId: comments.authorId })
		.from(comments)
		.where(eq(comments.id, commentId));
	if (!c) throw new CommentNotFoundError();
	if (c.authorId !== user.id && user.role !== 'moderator' && user.role !== 'admin') {
		throw new CommentPermissionError();
	}
	await db.delete(comments).where(eq(comments.id, commentId));
}

/**
 * Records that the user has seen a meme. The single seen-write (detail view and
 * Entdecken): inserts the mediaViews row and bumps media.viewCount only when the
 * row was new, in one transaction, so repeats and races never double-count.
 */
export async function markSeen(userId: number, mediaId: number): Promise<void> {
	const [m] = await db.select({ id: media.id }).from(media).where(eq(media.id, mediaId));
	if (!m) throw new MediaNotFoundError();
	await db.transaction(async (tx) => {
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
	});
}
