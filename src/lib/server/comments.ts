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
import { notify, storedCommentExcerpt, type NotificationKind } from './notifications';
import type { SessionUser } from './auth/session';
import { MediaNotFoundError, type VoteValue } from './votes';
import { MAX_COMMENT_LENGTH, MAX_MENTIONS, mentionIds } from '../mentions';
import { mentionNames, resolveMentions, TooManyMentionsError } from './mentions';
import { EDIT_WINDOW_MS } from '../comment-tree';

export { TooManyMentionsError, MAX_COMMENT_LENGTH, EDIT_WINDOW_MS };

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
export class CommentVoteOwnError extends Error {
	constructor() {
		super('Own comments cannot be voted on');
	}
}
export class CommentPermissionError extends Error {
	constructor() {
		super('Not allowed to change this comment');
	}
}
export class CommentEditWindowError extends Error {
	constructor() {
		super('Comments can only be edited for 5 minutes');
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
	/** When the author last edited the text (ISO), null if never; null on tombstones. */
	editedAt: string | null;
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
	createdAt: comments.createdAt,
	editedAt: comments.editedAt
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
			underReview: false,
			editedAt: null
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
		underReview: r.underReview,
		editedAt: r.editedAt?.toISOString() ?? null
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
	// Resolved up front: inside the transaction only `tx` may be used, since a query on the global
	// `db` would wait for a second pool connection while this one is held (a deadlock under load).
	const mentioned = await resolveMentions(trimmed);
	const names = await mentionNames(mentionIds(trimmed));
	return db.transaction(async (tx) => {
		let replyAuthorId: number | null = null;
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
					authorId: comments.authorId,
					deletedAt: comments.deletedAt
				})
				.from(comments)
				.where(eq(comments.id, replyToId))
				.for('update');
			if (!target || target.mediaId !== mediaId || target.deletedAt)
				throw new CommentNotFoundError();
			replyAuthorId = target.authorId;
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

		// one notice per person: later assignments win, so the order is the precedence
		// (thread_comment < comment < mention < comment_reply, the last only for the answered author)
		const kinds = new Map<number, NotificationKind>();
		for (const { authorId } of earlier) kinds.set(authorId, 'thread_comment');
		kinds.set(m.uploaderId, 'comment');
		for (const { userId: mentionedId } of mentioned) kinds.set(mentionedId, 'mention');
		// the answered author always hears "replied to you", even when the text also mentions them
		// (the composer pre-fills that mention on level-3 replies)
		if (replyAuthorId !== null) kinds.set(replyAuthorId, 'comment_reply');

		const base = {
			actorId: userId,
			contentType: 'comment',
			contentId: inserted.id,
			mediaId,
			// raw tokens: listNotifications renders the current names
			detail: storedCommentExcerpt(trimmed)
		} as const;
		// ascending user id keeps the per-recipient locks in notify from deadlocking concurrent comments;
		// notify skips the author themselves
		for (const [recipient, kind] of [...kinds].sort((x, y) => x[0] - y[0])) {
			await notify(tx, { ...base, userId: recipient, kind });
		}

		const [row] = await selectRows(tx, userId, eq(comments.id, inserted.id));
		return toItem(row, names, false);
	});
}

/**
 * Replaces the text of the author's own comment within EDIT_WINDOW_MS of posting and marks it
 * edited. Same text rules as addComment; only members newly mentioned by the edit are notified.
 * Tombstones and comments hidden for review count as missing; anyone but the author gets
 * CommentPermissionError (moderators delete instead).
 */
export async function editComment(
	userId: number,
	commentId: number,
	text: string
): Promise<CommentItem> {
	const trimmed = text.trim();
	if (trimmed.length < 1 || trimmed.length > MAX_COMMENT_LENGTH) throw new CommentTextError();
	if (mentionIds(trimmed).length > MAX_MENTIONS) throw new TooManyMentionsError();
	await assertNotTimedOut({ id: userId });
	// resolved up front: inside the transaction only `tx` may be used (see addComment)
	const mentioned = await resolveMentions(trimmed);
	const names = await mentionNames(mentionIds(trimmed));
	return db.transaction(async (tx) => {
		// locked so a concurrent delete, reply or second edit serialises with this one
		const [c] = await tx
			.select({
				authorId: comments.authorId,
				text: comments.text,
				createdAt: comments.createdAt,
				deletedAt: comments.deletedAt,
				mediaId: comments.mediaId
			})
			.from(comments)
			.where(eq(comments.id, commentId))
			.for('update');
		if (!c || c.deletedAt) throw new CommentNotFoundError();
		if (await hiddenForReview(tx, commentId)) throw new CommentNotFoundError();
		if (c.authorId !== userId) throw new CommentPermissionError();
		// created_at was written by this same database, so comparing it with the app clock only
		// carries the (negligible) skew between this process and the database host
		if (Date.now() - c.createdAt.getTime() > EDIT_WINDOW_MS) throw new CommentEditWindowError();

		await tx
			.update(comments)
			.set({ text: trimmed, editedAt: sql`now()` })
			.where(eq(comments.id, commentId));

		// only members the edit newly mentions hear about it; ascending user id keeps the
		// per-recipient locks in notify from deadlocking (see addComment)
		const before = new Set(mentionIds(c.text));
		const fresh = mentioned
			.filter((m) => !before.has(m.publicId))
			.map((m) => m.userId)
			.sort((a, b) => a - b);
		for (const recipient of fresh) {
			await notify(tx, {
				userId: recipient,
				kind: 'mention',
				actorId: userId,
				contentType: 'comment',
				contentId: commentId,
				mediaId: c.mediaId,
				detail: storedCommentExcerpt(trimmed)
			});
		}

		const [row] = await selectRows(tx, userId, eq(comments.id, commentId));
		return toItem(row, names, false);
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

/**
 * Sets the user's vote on a comment (0 clears it) and returns the aggregated score. A comment under
 * review, or on a meme under review, counts as missing unless `revealAll` (moderators).
 */
export async function voteComment(
	userId: number,
	commentId: number,
	value: VoteValue,
	revealAll = false
): Promise<{ score: number; userVote: VoteValue }> {
	await assertNotTimedOut({ id: userId });
	return db.transaction(async (tx) => {
		const [c] = await tx
			.select({ authorId: comments.authorId, deletedAt: comments.deletedAt })
			.from(comments)
			.where(eq(comments.id, commentId))
			.for('update');
		if (!c || c.deletedAt) throw new CommentNotFoundError();
		if (!revealAll && (await hiddenForReview(tx, commentId))) throw new CommentNotFoundError();
		if (c.authorId === userId) throw new CommentVoteOwnError();
		if (value === 0) {
			await tx
				.delete(commentVotes)
				.where(and(eq(commentVotes.userId, userId), eq(commentVotes.commentId, commentId)));
		} else {
			await tx
				.insert(commentVotes)
				.values({ userId, commentId, value })
				.onConflictDoUpdate({
					target: [commentVotes.userId, commentVotes.commentId],
					set: { value }
				});
		}
		const [{ score }] = await tx
			.select({ score: sql<number>`coalesce(sum(${commentVotes.value}), 0)::int` })
			.from(commentVotes)
			.where(eq(commentVotes.commentId, commentId));
		return { score, userVote: value };
	});
}

/** True while the comment or its meme is hidden for review. */
async function hiddenForReview(tx: Tx, commentId: number): Promise<boolean> {
	const [row] = await tx
		.select({
			hidden: sql<boolean>`(${underReviewSql('comment', comments.id, comments.reviewedAt)} OR ${underReviewSql('meme', media.id, media.reviewedAt)})`
		})
		.from(comments)
		.innerJoin(media, eq(media.id, comments.mediaId))
		.where(eq(comments.id, commentId));
	return row?.hidden === true;
}
