import { and, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { NOTIFICATION_CATEGORY } from '../notification-labels';
import { db } from './db';
import { media, notificationPrefs, notifications, quotes, users } from './db/schema';
import { underReviewSql, type ContentType, type Executor } from './moderation';

export const NOTIFICATION_KINDS = [
	'comment',
	'thread_comment',
	'content_deleted',
	'content_flagged',
	'content_released',
	'report_resolved',
	'timeout_set',
	'timeout_lifted',
	'name_changed',
	'name_reset',
	'avatar_removed',
	'motto_cleared'
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const EXCERPT_LENGTH = 80;
const PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NotificationPrefs = {
	comments: boolean;
	threadComments: boolean;
	reportOutcomes: boolean;
};

/** The optional kinds and the preference that switches each off. Every other kind ignores prefs. */
const PREF_FOR_KIND: Partial<Record<NotificationKind, keyof NotificationPrefs>> = {
	comment: 'comments',
	thread_comment: 'threadComments',
	report_resolved: 'reportOutcomes'
};

/** Kinds that fold into an existing unread row instead of adding a new one. */
const COALESCING_KINDS: readonly NotificationKind[] = ['comment', 'thread_comment'];

/** Where each profile-change notice leads. */
const PROFILE_KINDS: readonly NotificationKind[] = [
	'name_changed',
	'name_reset',
	'avatar_removed',
	'motto_cleared'
];

/** First 80 characters of a comment, trimmed, with every run of whitespace (line breaks too) as one space. */
export function commentExcerpt(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return [...flat].slice(0, EXCERPT_LENGTH).join('').trim();
}

export interface NotifyInput {
	userId: number;
	kind: NotificationKind;
	actorId?: number | null;
	contentType?: ContentType | null;
	contentId?: number | null;
	mediaId?: number | null;
	detail?: string;
}

/**
 * Writes a notice for `userId`. Pass the caller's transaction so a failed action leaves no stray
 * notice. Writes nothing when the recipient is the actor or has switched the kind off (the actor is
 * stored for activity kinds only, moderation kinds store none); folds
 * `comment` and `thread_comment` into the recipient's unread notice of that kind for the same meme.
 */
export async function notify(tx: Executor, input: NotifyInput): Promise<void> {
	const { userId, kind } = input;
	const mediaId = input.mediaId ?? null;
	const detail = input.detail ?? '';
	if (input.actorId != null && input.actorId === userId) return;
	// moderation notices never name who acted ("A moderator ..."): the audit log holds the name
	const actorId = NOTIFICATION_CATEGORY[kind] === 'moderation' ? null : (input.actorId ?? null);

	const prefKey = PREF_FOR_KIND[kind];
	if (prefKey) {
		const [prefs] = await tx
			.select()
			.from(notificationPrefs)
			.where(eq(notificationPrefs.userId, userId));
		if (prefs && !prefs[prefKey]) return;
	}

	if (COALESCING_KINDS.includes(kind)) {
		// FOR UPDATE: two commenters at once must fold into one row, not both insert or both read count 1
		const [open] = await tx
			.select({ id: notifications.id })
			.from(notifications)
			.where(
				and(
					eq(notifications.userId, userId),
					eq(notifications.kind, kind),
					mediaId === null ? isNull(notifications.mediaId) : eq(notifications.mediaId, mediaId),
					isNull(notifications.readAt)
				)
			)
			.orderBy(desc(notifications.id))
			.limit(1)
			.for('update');
		if (open) {
			await tx
				.update(notifications)
				.set({
					count: sql`${notifications.count} + 1`,
					actorId,
					detail,
					updatedAt: sql`now()`
				})
				.where(eq(notifications.id, open.id));
			return;
		}
	}

	await tx.insert(notifications).values({
		userId,
		kind,
		actorId,
		contentType: input.contentType ?? null,
		contentId: input.contentId ?? null,
		mediaId,
		detail
	});
}

/** Unread notices of a member: the bell count. */
export async function countUnread(userId: number): Promise<number> {
	const [row] = await db.execute<{ n: number }>(sql`
		SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL
	`);
	return row.n;
}

export interface NotificationItem {
	id: number;
	kind: NotificationKind;
	actor: { name: string; avatarThumbKey: string | null } | null;
	contentType: ContentType | null;
	mediaId: number | null;
	/** The meme's title; null when the notice has no meme. */
	title: string | null;
	detail: string;
	count: number;
	read: boolean;
	updatedAt: string;
}

/**
 * A member's notices, newest activity first. `before` is the id of the last row of the previous
 * page: the page continues strictly below that row's (updatedAt, id), so a coalesced bump of an
 * older row never skips or repeats one. An unknown `before` gives the first page.
 */
export async function listNotifications(
	userId: number,
	opts: { filter?: 'activity' | 'moderation'; before?: number; limit?: number }
): Promise<{ items: NotificationItem[]; hasMore: boolean }> {
	const limit = opts.limit ?? PAGE_SIZE;
	const kinds = opts.filter
		? NOTIFICATION_KINDS.filter((k) => NOTIFICATION_CATEGORY[k] === opts.filter)
		: null;

	let cursor: SQL | undefined;
	if (opts.before !== undefined) {
		const [row] = await db
			.select({ id: notifications.id })
			.from(notifications)
			.where(and(eq(notifications.id, opts.before), eq(notifications.userId, userId)));
		// Compared in SQL: a JS Date would cut the timestamp to milliseconds and mis-order close rows
		if (row) {
			cursor = sql`(${notifications.updatedAt}, ${notifications.id}) < (
				SELECT updated_at, id FROM notifications WHERE id = ${row.id}
			)`;
		}
	}

	const rows = await db
		.select({
			id: notifications.id,
			kind: notifications.kind,
			actorName: sql<string | null>`COALESCE(${users.displayName}, ${users.username})`,
			actorAvatarThumbKey: users.avatarThumbKey,
			hasActor: users.id,
			contentType: notifications.contentType,
			mediaId: notifications.mediaId,
			title: media.title,
			titleHidden: underReviewSql('meme', media.id, media.reviewedAt),
			detail: notifications.detail,
			count: notifications.count,
			readAt: notifications.readAt,
			updatedAt: notifications.updatedAt
		})
		.from(notifications)
		.leftJoin(users, eq(users.id, notifications.actorId))
		.leftJoin(media, eq(media.id, notifications.mediaId))
		.where(
			and(
				eq(notifications.userId, userId),
				kinds ? inArray(notifications.kind, kinds) : undefined,
				cursor
			)
		)
		.orderBy(desc(notifications.updatedAt), desc(notifications.id))
		.limit(limit + 1);

	const items = rows.slice(0, limit).map((r): NotificationItem => ({
		id: r.id,
		kind: r.kind as NotificationKind,
		actor:
			r.hasActor === null || r.actorName === null
				? null
				: { name: r.actorName, avatarThumbKey: r.actorAvatarThumbKey },
		contentType: r.contentType,
		mediaId: r.mediaId,
		// never text the recipient could not see on the meme's page
		title: r.titleHidden ? null : r.title,
		detail: r.detail,
		count: r.count,
		read: r.readAt !== null,
		updatedAt: r.updatedAt.toISOString()
	}));
	return { items, hasMore: rows.length > limit };
}

/**
 * Marks a notice read and returns where it leads. Null when the id is unknown or belongs to
 * someone else (nothing is marked then). Bookkeeping only, so it must keep working in maintenance.
 */
export async function openNotification(userId: number, id: number): Promise<string | null> {
	const [row] = await db
		.select({
			kind: notifications.kind,
			contentType: notifications.contentType,
			contentId: notifications.contentId,
			mediaId: notifications.mediaId
		})
		.from(notifications)
		.where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
	if (!row) return null;

	await db
		.update(notifications)
		.set({ readAt: sql`now()` })
		.where(and(eq(notifications.id, id), isNull(notifications.readAt)));

	const kind = row.kind as NotificationKind;
	if (PROFILE_KINDS.includes(kind)) return '/profile/edit';
	if (kind === 'timeout_set') return '/rules';
	if (row.mediaId !== null) return `/meme/${row.mediaId}`;
	if (row.contentType === 'quote' && row.contentId !== null) {
		const [quote] = await db
			.select({ id: quotes.id })
			.from(quotes)
			.where(eq(quotes.id, row.contentId));
		if (quote) return '/quotes';
	}
	return '/notifications';
}

export async function markAllRead(userId: number): Promise<void> {
	await db
		.update(notifications)
		.set({ readAt: sql`now()` })
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function getPrefs(userId: number): Promise<NotificationPrefs> {
	const [row] = await db
		.select({
			comments: notificationPrefs.comments,
			threadComments: notificationPrefs.threadComments,
			reportOutcomes: notificationPrefs.reportOutcomes
		})
		.from(notificationPrefs)
		.where(eq(notificationPrefs.userId, userId));
	return row ?? { comments: true, threadComments: true, reportOutcomes: true };
}

export async function setPrefs(userId: number, prefs: NotificationPrefs): Promise<void> {
	const values = {
		comments: prefs.comments,
		threadComments: prefs.threadComments,
		reportOutcomes: prefs.reportOutcomes
	};
	await db
		.insert(notificationPrefs)
		.values({ userId, ...values })
		.onConflictDoUpdate({ target: notificationPrefs.userId, set: values });
}

/** Retention: deletes notices whose last activity is older than `olderThanDays`, read or not. Returns the count. */
export async function sweepNotifications(olderThanDays = 90, now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS);
	const deleted = await db
		.delete(notifications)
		.where(lt(notifications.updatedAt, cutoff))
		.returning({ id: notifications.id });
	return deleted.length;
}
