import { and, desc, eq, isNull, lt, gt, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { auditLog, comments, media, quotes, reports, timeouts, users } from './db/schema';
import { env } from './env';

export type ContentType = (typeof reports.$inferInsert)['contentType'];
export type ReportCategory = (typeof reports.$inferInsert)['category'];
export type ReportOutcome = NonNullable<(typeof reports.$inferInsert)['outcome']>;

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
	'verletzend',
	'verstoerend',
	'falschinfo',
	'spam',
	'sonstiges'
];

export const AUDIT_ACTIONS = {
	reportDismissed: 'report_dismissed',
	contentDeleted: 'content_deleted',
	flagsForced: 'flags_forced',
	timeoutSet: 'timeout_set',
	timeoutLifted: 'timeout_lifted',
	contentReleased: 'content_released'
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const MAX_REPORT_TEXT = 500;
export const MAX_TIMEOUT_REASON = 500;
export const MAX_TIMEOUT_DAYS = 30;
const EXCERPT_LENGTH = 200;
const AUDIT_PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportErrorCode = 'own' | 'duplicate' | 'notfound' | 'invalid' | 'unreportable';

/** Rejected report. 'unreportable' = the content has no author left to attribute it to. */
export class ReportError extends Error {
	constructor(readonly code: ReportErrorCode) {
		super(`Report rejected: ${code}`);
	}
}

/** Thrown for a write attempt by a user with an active timeout. */
export class TimeoutActiveError extends Error {
	constructor(
		readonly until: Date,
		readonly reason: string
	) {
		super(`User is timed out until ${until.toISOString()}: ${reason}`);
	}
}

export type TimeoutErrorCode = 'self' | 'forbidden' | 'invalid' | 'notfound';

/** Rejected setTimeout_/liftTimeout. 'notfound' = no such user, or nothing to lift. */
export class TimeoutActionError extends Error {
	constructor(readonly code: TimeoutErrorCode) {
		super(`Timeout action rejected: ${code}`);
	}
}

type Executor = Pick<typeof db, 'select' | 'insert' | 'update'>;

const ROLE_RANK = { member: 0, moderator: 1, admin: 2 } as const;

// --- audit -----------------------------------------------------------------------------------

/**
 * Appends an audit row. Pass `executor` (a transaction) to write it atomically with the mutation
 * it describes.
 */
export async function audit(
	actorId: number,
	action: AuditAction,
	targetType: string,
	targetId: number,
	detail = '',
	executor: Executor = db
): Promise<void> {
	await executor.insert(auditLog).values({ actorId, action, targetType, targetId, detail });
}

export interface AuditEntry {
	id: number;
	actorId: number;
	actorName: string;
	action: string;
	targetType: string;
	targetId: number;
	detail: string;
	createdAt: Date;
}

/** Newest first. `cursor` is the previous page's nextCursor (the last id seen). */
export async function listAudit(
	filter: { action?: string } = {},
	cursor?: number
): Promise<{ entries: AuditEntry[]; nextCursor: number | null }> {
	const rows = await db
		.select({
			id: auditLog.id,
			actorId: auditLog.actorId,
			actorName: users.username,
			action: auditLog.action,
			targetType: auditLog.targetType,
			targetId: auditLog.targetId,
			detail: auditLog.detail,
			createdAt: auditLog.createdAt
		})
		.from(auditLog)
		.innerJoin(users, eq(users.id, auditLog.actorId))
		.where(
			and(
				filter.action ? eq(auditLog.action, filter.action) : undefined,
				cursor !== undefined ? lt(auditLog.id, cursor) : undefined
			)
		)
		.orderBy(desc(auditLog.id))
		.limit(AUDIT_PAGE_SIZE + 1);
	const entries = rows.slice(0, AUDIT_PAGE_SIZE);
	const nextCursor = rows.length > AUDIT_PAGE_SIZE ? entries[entries.length - 1].id : null;
	return { entries, nextCursor };
}

// --- timeouts --------------------------------------------------------------------------------

const activeTimeoutWhere = (userId: number) =>
	and(eq(timeouts.userId, userId), isNull(timeouts.liftedAt), gt(timeouts.until, sql`now()`));

export async function activeTimeout(
	userId: number,
	executor: Executor = db
): Promise<{ until: Date; reason: string } | null> {
	const [row] = await executor
		.select({ until: timeouts.until, reason: timeouts.reason })
		.from(timeouts)
		.where(activeTimeoutWhere(userId))
		.orderBy(desc(timeouts.until))
		.limit(1);
	return row ?? null;
}

/** Throws TimeoutActiveError while the user has an active timeout. Called by every write module. */
export async function assertNotTimedOut(user: Pick<SessionUser, 'id'>): Promise<void> {
	const active = await activeTimeout(user.id);
	if (active) throw new TimeoutActiveError(active.until, active.reason);
}

/** Moderators may time out members only; admins members, moderators and admins; nobody themselves. */
function assertMayTimeout(actor: SessionUser, target: { id: number; role: SessionUser['role'] }) {
	if (actor.id === target.id) throw new TimeoutActionError('self');
	if (actor.role === 'member') throw new TimeoutActionError('forbidden');
	if (actor.role === 'moderator' && ROLE_RANK[target.role] >= ROLE_RANK.moderator) {
		throw new TimeoutActionError('forbidden');
	}
}

async function lockTarget(tx: Executor, userId: number) {
	const [target] = await tx
		.select({ id: users.id, role: users.role })
		.from(users)
		.where(eq(users.id, userId))
		.for('update');
	if (!target) throw new TimeoutActionError('notfound');
	return target;
}

/**
 * Times a user out for `days` (integer 1-30). An active timeout is replaced: the old row is lifted
 * by the actor (with its own audit entry) and a new one created. The target user row is locked so
 * concurrent calls serialize.
 */
export async function setTimeout_(
	actor: SessionUser,
	userId: number,
	days: number,
	reason: string
): Promise<void> {
	if (!Number.isInteger(days) || days < 1 || days > MAX_TIMEOUT_DAYS) {
		throw new TimeoutActionError('invalid');
	}
	const trimmed = reason.trim();
	if (trimmed.length < 1 || trimmed.length > MAX_TIMEOUT_REASON) {
		throw new TimeoutActionError('invalid');
	}

	await db.transaction(async (tx) => {
		assertMayTimeoutBeforeLookup(actor, userId);
		const target = await lockTarget(tx, userId);
		assertMayTimeout(actor, target);

		const [previous] = await tx
			.update(timeouts)
			.set({ liftedAt: sql`now()`, liftedBy: actor.id })
			.where(activeTimeoutWhere(userId))
			.returning({ id: timeouts.id });
		if (previous) {
			await audit(actor.id, AUDIT_ACTIONS.timeoutLifted, 'user', userId, 'ersetzt', tx);
		}

		const until = new Date(Date.now() + days * DAY_MS);
		await tx.insert(timeouts).values({ userId, setBy: actor.id, reason: trimmed, until });
		await audit(actor.id, AUDIT_ACTIONS.timeoutSet, 'user', userId, `${days} Tage: ${trimmed}`, tx);
	});
}

/** Cheap pre-check so self/role violations never depend on the target existing. */
function assertMayTimeoutBeforeLookup(actor: SessionUser, userId: number) {
	if (actor.id === userId) throw new TimeoutActionError('self');
	if (actor.role === 'member') throw new TimeoutActionError('forbidden');
}

/** Lifts the active timeout of a user. Same actor rules as setting one. */
export async function liftTimeout(actor: SessionUser, userId: number): Promise<void> {
	await db.transaction(async (tx) => {
		assertMayTimeoutBeforeLookup(actor, userId);
		const target = await lockTarget(tx, userId);
		assertMayTimeout(actor, target);

		const lifted = await tx
			.update(timeouts)
			.set({ liftedAt: sql`now()`, liftedBy: actor.id })
			.where(activeTimeoutWhere(userId))
			.returning({ id: timeouts.id });
		if (lifted.length === 0) throw new TimeoutActionError('notfound');
		await audit(actor.id, AUDIT_ACTIONS.timeoutLifted, 'user', userId, '', tx);
	});
}

// --- reports ---------------------------------------------------------------------------------

interface ContentSnapshot {
	authorId: number | null;
	excerpt: string;
}

/** Locks the content row (serializing concurrent reports on it) and snapshots author + excerpt. */
async function snapshotContent(
	tx: Executor,
	contentType: ContentType,
	contentId: number
): Promise<ContentSnapshot | null> {
	if (contentType === 'meme') {
		const [row] = await tx
			.select({ authorId: media.uploaderId, title: media.title })
			.from(media)
			.where(eq(media.id, contentId))
			.for('update');
		if (!row) return null;
		return { authorId: row.authorId, excerpt: row.title.trim() || `Meme #${contentId}` };
	}
	if (contentType === 'comment') {
		const [row] = await tx
			.select({ authorId: comments.authorId, text: comments.text })
			.from(comments)
			.where(eq(comments.id, contentId))
			.for('update');
		return row ? { authorId: row.authorId, excerpt: row.text.slice(0, EXCERPT_LENGTH) } : null;
	}
	const [row] = await tx
		.select({ authorId: quotes.submittedBy, text: quotes.text })
		.from(quotes)
		.where(eq(quotes.id, contentId))
		.for('update');
	return row ? { authorId: row.authorId, excerpt: row.text.slice(0, EXCERPT_LENGTH) } : null;
}

const contentTable = { meme: media, comment: comments, quote: quotes } as const;

export async function createReport(
	user: SessionUser,
	contentType: ContentType,
	contentId: number,
	category: ReportCategory,
	text = ''
): Promise<void> {
	if (!REPORT_CATEGORIES.includes(category) || text.length > MAX_REPORT_TEXT) {
		throw new ReportError('invalid');
	}
	await assertNotTimedOut(user);

	await db.transaction(async (tx) => {
		const content = await snapshotContent(tx, contentType, contentId);
		if (!content) throw new ReportError('notfound');
		if (content.authorId === null) throw new ReportError('unreportable');
		if (content.authorId === user.id) throw new ReportError('own');

		const [duplicate] = await tx
			.select({ id: reports.id })
			.from(reports)
			.where(
				and(
					eq(reports.reporterId, user.id),
					eq(reports.contentType, contentType),
					eq(reports.contentId, contentId),
					eq(reports.status, 'open')
				)
			)
			.limit(1);
		if (duplicate) throw new ReportError('duplicate');

		await tx.insert(reports).values({
			contentType,
			contentId,
			reporterId: user.id,
			authorId: content.authorId,
			category,
			text: text.trim(),
			excerpt: content.excerpt
		});
	});
}

/**
 * The ONE definition of "open reporter count", as a SELECT (single column `n`): distinct reporters
 * with an open report on the content, excluding reporters with an active timeout. `idExpr` is the
 * content id as SQL (a column of the surrounding query, or a bound value). Used verbatim by
 * openReportCount (standalone), by the feed (as a LATERAL join) and by the comment/quote/media
 * read paths (as a scalar subquery), so the visibility rule cannot drift between them.
 */
export function openReporterCountSelect(contentType: ContentType, idExpr: SQL): SQL {
	return sql`SELECT count(DISTINCT r.reporter_id)::int AS n
		FROM reports r
		WHERE r.content_type = ${contentType}
			AND r.content_id = ${idExpr}
			AND r.status = 'open'
			AND NOT EXISTS (
				SELECT 1 FROM timeouts t
				WHERE t.user_id = r.reporter_id AND t.lifted_at IS NULL AND t.until > now()
			)`;
}

/** The threshold test on a count expression: STRICTLY above REPORT_REVIEW_THRESHOLD. */
export const overThresholdSql = (countExpr: SQL): SQL =>
	sql`(${countExpr}) > ${env.REPORT_REVIEW_THRESHOLD}`;

/** SQL predicate form of isUnderReview for a row in the surrounding query (scalar subquery). */
export function underReviewSql(
	contentType: ContentType,
	idExpr: SQL | AnyColumn,
	reviewedAtExpr: SQL | AnyColumn
): SQL<boolean> {
	return sql<boolean>`(${reviewedAtExpr} IS NULL AND ${overThresholdSql(
		sql`${openReporterCountSelect(contentType, sql`${idExpr}`)}`
	)})`;
}

/** Distinct open reporters of a content item, excluding reporters with an active timeout. */
export async function openReportCount(
	contentType: ContentType,
	contentId: number
): Promise<number> {
	const [row] = await db.execute<{ n: number }>(
		openReporterCountSelect(contentType, sql`${contentId}::integer`)
	);
	return row.n;
}

/** True once the count is STRICTLY above the threshold and no moderator has released the item. */
export async function isUnderReview(contentType: ContentType, contentId: number): Promise<boolean> {
	const table = contentTable[contentType];
	const [row] = await db
		.select({ reviewedAt: table.reviewedAt })
		.from(table)
		.where(eq(table.id, contentId));
	if (!row || row.reviewedAt !== null) return false;
	return (await openReportCount(contentType, contentId)) > env.REPORT_REVIEW_THRESHOLD;
}

/**
 * True when the stored media object (original OR thumbnail key) belongs to a meme that is under
 * review. Unknown keys are not under review (nothing to hide).
 */
export async function isMediaKeyUnderReview(key: string): Promise<boolean> {
	const [row] = await db
		.select({ hidden: underReviewSql('meme', media.id, media.reviewedAt) })
		.from(media)
		.where(or(eq(media.objectKey, key), eq(media.thumbKey, key)))
		.limit(1);
	return row?.hidden === true;
}

/** Moderators and admins see under-review content in full. */
export const canSeeUnderReview = (user: Pick<SessionUser, 'role'>): boolean =>
	user.role === 'moderator' || user.role === 'admin';

/** Runs `fn` on the given executor, or in a fresh transaction when the caller has none. */
const inTransaction = <T>(executor: Executor | undefined, fn: (tx: Executor) => Promise<T>) =>
	executor ? fn(executor) : db.transaction((tx) => fn(tx));

/** Closes the open reports of a content item and returns what was closed (excerpt, author). */
function closeOpenReports(
	tx: Executor,
	actor: SessionUser,
	contentType: ContentType,
	contentId: number,
	outcome: ReportOutcome
) {
	return tx
		.update(reports)
		.set({ status: 'resolved', outcome, resolvedAt: sql`now()`, resolvedBy: actor.id })
		.where(
			and(
				eq(reports.contentType, contentType),
				eq(reports.contentId, contentId),
				eq(reports.status, 'open')
			)
		)
		.returning({ excerpt: reports.excerpt, authorId: reports.authorId });
}

/**
 * Closes all open reports of a content item with `outcome` and returns how many it closed (0 =
 * nothing was open, e.g. somebody else was faster). 'dismissed' (release) also stamps the
 * content's reviewedAt, which grants permanent immunity from auto-hiding, and writes the audit
 * row, both only when at least one report was actually closed. 'actioned' / 'removed' write no
 * audit row here: the caller audits the concrete action it performed (resolveWithAudit,
 * timeout_set). Pass `executor` to run inside the caller's transaction.
 */
export async function resolveReports(
	actor: SessionUser,
	contentType: ContentType,
	contentId: number,
	outcome: ReportOutcome,
	executor?: Executor
): Promise<number> {
	return inTransaction(executor, async (tx) => {
		const closed = await closeOpenReports(tx, actor, contentType, contentId, outcome);
		if (outcome !== 'dismissed' || closed.length === 0) return closed.length;

		const table = contentTable[contentType];
		await tx
			.update(table)
			.set({ reviewedAt: sql`now()` })
			.where(eq(table.id, contentId));
		await audit(
			actor.id,
			AUDIT_ACTIONS.reportDismissed,
			contentType,
			contentId,
			`${closed.length} Meldungen: ${closed[0].excerpt}`,
			tx
		);
		return closed.length;
	});
}

/**
 * Deleting a meme cascades its comments away; their open reports would stay open forever (reports
 * have no foreign key). Closes them with `outcome` in the caller's transaction, call it BEFORE the
 * meme row is deleted. No audit row: the meme's own deletion is the decision.
 */
export async function resolveCommentReportsOfMedia(
	actor: SessionUser,
	mediaId: number,
	outcome: ReportOutcome,
	executor: Executor
): Promise<number> {
	const closed = await executor
		.update(reports)
		.set({ status: 'resolved', outcome, resolvedAt: sql`now()`, resolvedBy: actor.id })
		.where(
			and(
				eq(reports.contentType, 'comment'),
				eq(reports.status, 'open'),
				sql`${reports.contentId} IN (SELECT ${comments.id} FROM ${comments} WHERE ${comments.mediaId} = ${mediaId})`
			)
		)
		.returning({ id: reports.id });
	return closed.length;
}

/**
 * A moderator's concrete action on someone else's content (`content_deleted` / `flags_forced`):
 * closes the open reports as 'actioned' and writes the audit row, atomically. Does nothing (no
 * audit row) when the content has no open reports. `note` prefixes the audit detail. Used by the
 * content modules for inline actions and by the queue, so both behave identically.
 */
export async function resolveWithAudit(
	actor: SessionUser,
	contentType: ContentType,
	contentId: number,
	action: typeof AUDIT_ACTIONS.contentDeleted | typeof AUDIT_ACTIONS.flagsForced,
	note = '',
	executor?: Executor
): Promise<number> {
	return inTransaction(executor, async (tx) => {
		const closed = await closeOpenReports(tx, actor, contentType, contentId, 'actioned');
		if (closed.length === 0) return 0;
		const [author] = await tx
			.select({ username: users.username })
			.from(users)
			.where(eq(users.id, closed[0].authorId));
		await audit(
			actor.id,
			action,
			contentType,
			contentId,
			`${note}${author?.username ?? ''}: ${closed[0].excerpt}`,
			tx
		);
		return closed.length;
	});
}

/**
 * Closes the open reports of content that was just deleted. The author's own deletion closes them
 * as 'removed' (their own act, no audit row); anybody else is a moderator acting on foreign
 * content: 'actioned' plus a content_deleted audit row.
 */
export function resolveAfterDelete(
	actor: SessionUser,
	contentType: ContentType,
	contentId: number,
	authorId: number | null,
	executor?: Executor
): Promise<number> {
	return authorId === actor.id
		? resolveReports(actor, contentType, contentId, 'removed', executor)
		: resolveWithAudit(actor, contentType, contentId, AUDIT_ACTIONS.contentDeleted, '', executor);
}
