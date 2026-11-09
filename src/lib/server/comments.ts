import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from './db';
import { commentVotes, comments, media, mediaViews, users } from './db/schema';
import {
	assertNotTimedOut,
	resolveAfterDelete,
	snapshotContent,
	underReviewSql
} from './moderation';
import { commentExcerpt, notify } from './notifications';
import type { SessionUser } from './auth/session';
import { MediaNotFoundError } from './votes';
import { MAX_MENTIONS, mentionIds } from '../mentions';
import { mentionNames, TooManyMentionsError } from './mentions';

export { TooManyMentionsError };

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

/** The `id`, `mediaId` and `authorId` of an item are public ids; the functions below take internal numbers. */
export interface CommentItem {
	id: string;
	mediaId: string;
	/** Tree position: public id of the top-level or level-2 comment this hangs under; null at the top level. */
	parentId: string | null;
	/** Public id of the comment actually answered (differs from `parentId` for siblings on level 3). */
	replyToId: string | null;
	depth: 1 | 2 | 3;
	/** Tombstone: text null, author '' , authorId '', authorAvatar null, score 0, userVote 0. */
	deleted: boolean;
	authorId: string;
	/** Display name when set, else the username. */
	author: string;
	authorRole: 'member' | 'moderator' | 'admin';
	/** Thumb key of the author's avatar, null when they have none. */
	authorAvatar: string | null;
	/** Raw text with mention tokens; null while under review (for viewers who may not see it) or deleted. */
	text: string | null;
	/** Public id → current board name, for the mention tokens in `text`. */
	mentions: Record<string, string>;
	score: number;
	userVote: -1 | 0 | 1;
	underReview: boolean;
	createdAt: string;
}

const parentComments = alias(comments, 'parent_comments');
const replyComments = alias(comments, 'reply_comments');

const columnsFor = (viewerId: number) => ({
	id: comments.publicId,
	mediaId: media.publicId,
	parentId: parentComments.publicId,
	replyToId: replyComments.publicId,
	depth: comments.depth,
	deletedAt: comments.deletedAt,
	authorId: users.publicId,
	author: sql<string>`coalesce(${users.displayName}, ${users.username})`,
	authorRole: users.role,
	authorAvatar: users.avatarThumbKey,
	text: comments.text,
	score: sql<number>`coalesce((select sum(${commentVotes.value}) from ${commentVotes} where ${commentVotes.commentId} = ${comments.id}), 0)::int`,
	userVote: sql<number>`coalesce((select ${commentVotes.value} from ${commentVotes} where ${commentVotes.commentId} = ${comments.id} and ${commentVotes.userId} = ${viewerId}), 0)::int`,
	underReview: underReviewSql('comment', comments.id, comments.reviewedAt),
	createdAt: comments.createdAt
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Awaited<ReturnType<typeof selectRows>>[number];

function selectRows(ex: Pick<typeof db, 'select'>, viewerId: number, where: SQL) {
	return ex
		.select(columnsFor(viewerId))
		.from(comments)
		.innerJoin(users, eq(users.id, comments.authorId))
		.innerJoin(media, eq(media.id, comments.mediaId))
		.leftJoin(parentComments, eq(parentComments.id, comments.parentId))
		.leftJoin(replyComments, eq(replyComments.id, comments.replyToId))
		.where(where)
		.orderBy(comments.createdAt, comments.id);
}

function toItem(r: Row, names: Record<string, string>, revealAll: boolean): CommentItem {
	const base = {
		id: r.id,
		mediaId: r.mediaId,
		parentId: r.parentId,
		replyToId: r.replyToId,
		depth: r.depth as 1 | 2 | 3,
		createdAt: r.createdAt.toISOString()
	};
	if (r.deletedAt) {
		return {
			...base,
			deleted: true,
			authorId: '',
			author: '',
			authorRole: 'member',
			authorAvatar: null,
			text: null,
			mentions: {},
			score: 0,
			userVote: 0,
			underReview: false
		};
	}
	const hidden = r.underReview && !revealAll;
	return {
		...base,
		deleted: false,
		authorId: r.authorId,
		author: r.author,
		authorRole: r.authorRole,
		authorAvatar: r.authorAvatar,
		text: hidden ? null : r.text,
		mentions: hidden
			? {}
			: Object.fromEntries(
					mentionIds(r.text).flatMap((id) => (id in names ? [[id, names[id]]] : []))
				),
		score: r.score,
		userVote: Math.sign(r.userVote) as -1 | 0 | 1,
		underReview: r.underReview
	};
}

async function itemsOf(rows: Row[], revealAll: boolean): Promise<CommentItem[]> {
	const ids = [...new Set(rows.filter((r) => !r.deletedAt).flatMap((r) => mentionIds(r.text)))];
	const names = await mentionNames(ids);
	return rows.map((r) => toItem(r, names, revealAll));
}

/**
 * Comments of a meme, oldest first, with the viewer's own vote. Under-review texts are nulled
 * unless `revealAll` (moderators); tombstones are blanked for everyone.
 */
export async function listComments(
	mediaId: number,
	viewerId: number,
	revealAll = false
): Promise<CommentItem[]> {
	return itemsOf(await selectRows(db, viewerId, eq(comments.mediaId, mediaId)), revealAll);
}

export async function addComment(
	userId: number,
	mediaId: number,
	text: string,
	replyToId: number | null = null
): Promise<CommentItem> {
	const trimmed = text.trim();
	if (trimmed.length < 1 || trimmed.length > MAX_COMMENT_LENGTH) throw new CommentTextError();
	if (mentionIds(trimmed).length > MAX_MENTIONS) throw new TooManyMentionsError();
	await assertNotTimedOut({ id: userId });
	const [m] = await db
		.select({ id: media.id, uploaderId: media.uploaderId })
		.from(media)
		.where(eq(media.id, mediaId));
	if (!m) throw new MediaNotFoundError();
	return db.transaction(async (tx) => {
		let placement: { parentId: number | null; replyToId: number | null; depth: number } = {
			parentId: null,
			replyToId: null,
			depth: 1
		};
		if (replyToId !== null) {
			// locked so a concurrent delete cannot turn the target into a tombstone or remove it under us
			const [target] = await tx
				.select({
					id: comments.id,
					mediaId: comments.mediaId,
					parentId: comments.parentId,
					depth: comments.depth,
					deletedAt: comments.deletedAt
				})
				.from(comments)
				.where(eq(comments.id, replyToId))
				.for('update');
			if (!target || target.mediaId !== mediaId || target.deletedAt)
				throw new CommentNotFoundError();
			placement = {
				parentId: target.depth < 3 ? target.id : target.parentId,
				replyToId: target.id,
				depth: Math.min(target.depth + 1, 3)
			};
		}
		// earlier commenters are read before the insert, so the new comment never counts as one
		const earlier = await tx
			.selectDistinct({ authorId: comments.authorId })
			.from(comments)
			.where(and(eq(comments.mediaId, mediaId), isNull(comments.deletedAt)))
			// a fixed order keeps the per-recipient locks in notify from deadlocking two concurrent comments
			.orderBy(comments.authorId);
		const [inserted] = await tx
			.insert(comments)
			.values({ mediaId, authorId: userId, text: trimmed, ...placement })
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

		const rows = await selectRows(tx, userId, eq(comments.id, inserted.id));
		return (await itemsOf(rows, false))[0];
	});
}

/**
 * Author, moderator or admin may delete; everyone else gets CommentPermissionError. Closes the
 * comment's open reports in the same transaction (author: 'removed', no audit; moderator: always an audit row, reports 'actioned').
 * A comment that others answered stays as a tombstone (text erased); otherwise it is removed, and
 * tombstones that lose their last reply with it go too.
 */
export async function deleteComment(user: SessionUser, commentId: number): Promise<void> {
	const [c] = await db
		.select({
			authorId: comments.authorId,
			mediaId: comments.mediaId,
			deletedAt: comments.deletedAt
		})
		.from(comments)
		.where(eq(comments.id, commentId));
	if (!c || c.deletedAt) throw new CommentNotFoundError();
	if (c.authorId !== user.id && user.role !== 'moderator' && user.role !== 'admin') {
		throw new CommentPermissionError();
	}
	// Own comments may always be removed; moderating others' is suspended by a timeout.
	if (c.authorId !== user.id) await assertNotTimedOut(user);
	await db.transaction(async (tx) => {
		// locking the row serialises with addComment, which locks its reply target
		const [locked] = await tx
			.select({
				parentId: comments.parentId,
				replyToId: comments.replyToId,
				deletedAt: comments.deletedAt
			})
			.from(comments)
			.where(eq(comments.id, commentId))
			.for('update');
		if (!locked || locked.deletedAt) throw new CommentNotFoundError();
		const snapshot = await snapshotContent(tx, 'comment', commentId);
		if (await hasReplies(tx, commentId)) {
			await tx
				.update(comments)
				.set({ deletedAt: sql`now()`, text: '' })
				.where(eq(comments.id, commentId));
		} else {
			await tx.delete(comments).where(eq(comments.id, commentId));
			await removeOrphanTombstones(tx, [locked.parentId, locked.replyToId]);
		}
		await resolveAfterDelete(user, 'comment', commentId, c.authorId, tx, snapshot, c.mediaId);
	});
}

async function hasReplies(tx: Tx, id: number): Promise<boolean> {
	const [r] = await tx
		.select({ id: comments.id })
		.from(comments)
		.where(or(eq(comments.parentId, id), eq(comments.replyToId, id)))
		.limit(1);
	return !!r;
}

/** Deletes the given comments when they are tombstones nobody answers any more, walking up the tree. */
async function removeOrphanTombstones(tx: Tx, candidates: (number | null)[]): Promise<void> {
	const queue = candidates.filter((x): x is number => x !== null);
	while (queue.length > 0) {
		const id = queue.pop()!;
		const [t] = await tx
			.select({
				parentId: comments.parentId,
				replyToId: comments.replyToId,
				deletedAt: comments.deletedAt
			})
			.from(comments)
			.where(eq(comments.id, id))
			.for('update');
		if (!t?.deletedAt || (await hasReplies(tx, id))) continue;
		await tx.delete(comments).where(eq(comments.id, id));
		for (const next of [t.parentId, t.replyToId]) if (next !== null) queue.push(next);
	}
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
