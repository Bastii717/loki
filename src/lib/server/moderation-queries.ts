import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from './db';
import { comments, media, quotes, reports, templates, timeouts, users } from './db/schema';
import {
	underReviewSql,
	type ContentType,
	type ReportCategory,
	type ReportOutcome
} from './moderation';

/**
 * Read-only queries behind the /moderation pages. Every mutation goes through moderation.ts
 * (reports, timeouts, audit) or moderation-cases.ts (queue actions); nothing here writes. The
 * callers (routes) own the role check: these functions trust that the viewer may see everything.
 */

export const QUEUE_PAGE_SIZE = 20;
export const DONE_PAGE_SIZE = 20;
export const USER_SEARCH_LIMIT = 10;

type Role = (typeof users.$inferSelect)['role'];

export interface CaseReport {
	/** The reporter's public id. */
	reporterId: string;
	/** Username (stable identifier). */
	reporter: string;
	/** Display name when set, else the username. */
	reporterDisplay: string;
	category: ReportCategory;
	text: string;
	createdAt: string;
}

export type CasePreview =
	| {
			type: 'meme';
			/** The meme's public id (for the link to it). */
			id: string;
			title: string;
			kind: 'image' | 'gif' | 'video';
			thumbUrl: string;
			nsfw: boolean;
			spoiler: boolean;
	  }
	| { type: 'comment'; text: string; /** The meme's public id. */ mediaId: string }
	| { type: 'quote'; text: string; author: string };

interface CaseBase {
	contentType: ContentType;
	/**
	 * The internal content id. The one internal id the moderation views hand to a client: it round-trips
	 * through `POST /api/moderation/case` (server-provided, moderators only, spec ruling). Done cases
	 * (read-only) drop it before the page; everything shown or linked uses public ids.
	 */
	contentId: number;
	/** The author's public id. */
	authorId: string;
	/** Username (stable identifier). */
	author: string;
	/** Display name when set, else the username. */
	authorDisplay: string;
	authorRole: Role;
	/** Snapshot taken when the first report came in (survives deletion of the content). */
	excerpt: string;
	reports: CaseReport[];
	categories: { category: ReportCategory; count: number }[];
}

export interface OpenCase extends CaseBase {
	/** Age of the oldest open report. */
	oldest: string;
	/** Hidden from members right now (over the threshold, not released). */
	underReview: boolean;
	/** null when the content is already gone (deleted by the author or by other means). */
	preview: CasePreview | null;
}

export interface DoneCase extends CaseBase {
	/** Row id of the decision's first report: a stable list key (not a content or user id). */
	id: number;
	outcome: ReportOutcome;
	resolvedAt: string;
	resolvedBy: string;
}

// --- helpers ---------------------------------------------------------------------------------

const reporter = alias(users, 'reporter');
const resolver = alias(users, 'resolver');

const keyOf = (type: string, id: number) => `${type}:${id}`;

function countCategories(rows: { category: ReportCategory }[]): CaseBase['categories'] {
	const counts = new Map<ReportCategory, number>();
	for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
	return [...counts]
		.map(([category, count]) => ({ category, count }))
		.sort((a, b) => b.count - a.count);
}

interface AuthorInfo {
	publicId: string;
	username: string;
	display: string;
	role: Role;
}

async function authorsById(ids: number[]) {
	if (ids.length === 0) return new Map<number, AuthorInfo>();
	const rows = await db
		.select({
			id: users.id,
			publicId: users.publicId,
			username: users.username,
			displayName: users.displayName,
			role: users.role
		})
		.from(users)
		.where(inArray(users.id, ids));
	return new Map(
		rows.map((r) => [
			r.id,
			{
				publicId: r.publicId,
				username: r.username,
				display: r.displayName ?? r.username,
				role: r.role
			}
		])
	);
}

/** The reports behind a set of report ids, with reporter names, oldest first. */
async function reportRows(ids: number[]) {
	if (ids.length === 0) return [];
	return db
		.select({
			id: reports.id,
			contentType: reports.contentType,
			contentId: reports.contentId,
			reporterPublicId: reporter.publicId,
			reporter: reporter.username,
			reporterDisplay: sql<string>`coalesce(${reporter.displayName}, ${reporter.username})`,
			authorId: reports.authorId,
			category: reports.category,
			text: reports.text,
			excerpt: reports.excerpt,
			outcome: reports.outcome,
			createdAt: reports.createdAt,
			resolvedAt: reports.resolvedAt,
			resolvedBy: resolver.username
		})
		.from(reports)
		.innerJoin(reporter, eq(reporter.id, reports.reporterId))
		.leftJoin(resolver, eq(resolver.id, reports.resolvedBy))
		.where(inArray(reports.id, ids))
		.orderBy(asc(reports.id));
}

type ReportRow = Awaited<ReturnType<typeof reportRows>>[number];

const toCaseReport = (r: ReportRow): CaseReport => ({
	reporterId: r.reporterPublicId,
	reporter: r.reporter,
	reporterDisplay: r.reporterDisplay,
	category: r.category,
	text: r.text,
	createdAt: r.createdAt.toISOString()
});

// --- open cases ------------------------------------------------------------------------------

/** Number of open cases (content items with at least one open report). Drives the badge. */
export async function countOpenCases(): Promise<number> {
	const [row] = await db.execute<{ n: number }>(sql`
		SELECT count(*)::int AS n FROM (
			SELECT 1 FROM reports WHERE status = 'open' GROUP BY content_type, content_id
		) c
	`);
	return row.n;
}

async function previews(cases: { contentType: ContentType; contentId: number }[]) {
	const idsOf = (t: ContentType) =>
		cases.filter((c) => c.contentType === t).map((c) => c.contentId);
	const [memeIds, commentIds, quoteIds] = [idsOf('meme'), idsOf('comment'), idsOf('quote')];
	const [memeRows, commentRows, quoteRows] = await Promise.all([
		memeIds.length === 0
			? []
			: db
					.select({
						id: media.id,
						publicId: media.publicId,
						title: media.title,
						kind: media.kind,
						thumbKey: media.thumbKey,
						nsfw: media.nsfw,
						spoiler: media.spoiler,
						underReview: underReviewSql('meme', media.id, media.reviewedAt)
					})
					.from(media)
					.where(inArray(media.id, memeIds)),
		commentIds.length === 0
			? []
			: db
					.select({
						id: comments.id,
						text: sql<string>`mention_text(${comments.text})`,
						mediaPublicId: media.publicId,
						underReview: underReviewSql('comment', comments.id, comments.reviewedAt)
					})
					.from(comments)
					.innerJoin(media, eq(media.id, comments.mediaId))
					// a tombstone has no text left: no preview, so the case renders as gone
					.where(and(inArray(comments.id, commentIds), isNull(comments.deletedAt))),
		quoteIds.length === 0
			? []
			: db
					.select({
						id: quotes.id,
						text: quotes.text,
						author: quotes.author,
						underReview: underReviewSql('quote', quotes.id, quotes.reviewedAt)
					})
					.from(quotes)
					.where(inArray(quotes.id, quoteIds))
	]);

	const out = new Map<string, { preview: CasePreview; underReview: boolean }>();
	for (const m of memeRows) {
		out.set(keyOf('meme', m.id), {
			underReview: m.underReview,
			preview: {
				type: 'meme',
				id: m.publicId,
				title: m.title,
				kind: m.kind,
				thumbUrl: `/media/${m.thumbKey}`,
				nsfw: m.nsfw,
				spoiler: m.spoiler
			}
		});
	}
	for (const c of commentRows) {
		out.set(keyOf('comment', c.id), {
			underReview: c.underReview,
			preview: { type: 'comment', text: c.text, mediaId: c.mediaPublicId }
		});
	}
	for (const q of quoteRows) {
		out.set(keyOf('quote', q.id), {
			underReview: q.underReview,
			preview: { type: 'quote', text: q.text, author: q.author }
		});
	}
	return out;
}

/**
 * One page of the queue, oldest case first. A case is a content item with at least one open
 * report; `cursor` is the previous page's nextCursor (id of the last case's first report).
 */
export async function listOpenCases(
	cursor?: number
): Promise<{ cases: OpenCase[]; nextCursor: number | null }> {
	const groups = await db
		.select({
			contentType: reports.contentType,
			contentId: reports.contentId,
			firstId: sql<number>`min(${reports.id})`.as('first_id'),
			ids: sql<number[]>`array_agg(${reports.id})`
		})
		.from(reports)
		.where(eq(reports.status, 'open'))
		.groupBy(reports.contentType, reports.contentId)
		.having(cursor !== undefined ? sql`min(${reports.id}) > ${cursor}` : undefined)
		.orderBy(sql`first_id`)
		.limit(QUEUE_PAGE_SIZE + 1);

	const page = groups.slice(0, QUEUE_PAGE_SIZE);
	const nextCursor = groups.length > QUEUE_PAGE_SIZE ? page[page.length - 1].firstId : null;

	const rows = await reportRows(page.flatMap((g) => g.ids));
	const [authors, previewByKey] = await Promise.all([
		authorsById([...new Set(rows.map((r) => r.authorId))]),
		previews(page)
	]);

	const cases = page.map((g): OpenCase => {
		const mine = rows.filter((r) => r.contentType === g.contentType && r.contentId === g.contentId);
		const first = mine[0];
		const author = authors.get(first.authorId);
		const found = previewByKey.get(keyOf(g.contentType, g.contentId));
		return {
			contentType: g.contentType,
			contentId: g.contentId,
			authorId: author?.publicId ?? '',
			author: author?.username ?? '',
			authorDisplay: author?.display ?? '',
			authorRole: author?.role ?? 'member',
			excerpt: first.excerpt,
			reports: mine.map(toCaseReport),
			categories: countCategories(mine),
			oldest: first.createdAt.toISOString(),
			underReview: found?.underReview ?? false,
			preview: found?.preview ?? null
		};
	});
	return { cases, nextCursor };
}

/** The open case of one content item (server-side: `authorId` is the internal id), or null when it has no open reports (anymore). */
export async function getOpenCase(
	contentType: ContentType,
	contentId: number
): Promise<{ authorId: number; author: string; excerpt: string } | null> {
	const [row] = await db
		.select({ authorId: reports.authorId, author: users.username, excerpt: reports.excerpt })
		.from(reports)
		.innerJoin(users, eq(users.id, reports.authorId))
		.where(
			and(
				eq(reports.contentType, contentType),
				eq(reports.contentId, contentId),
				eq(reports.status, 'open')
			)
		)
		.orderBy(asc(reports.id))
		.limit(1);
	return row ?? null;
}

// --- resolved cases --------------------------------------------------------------------------

const encodeDoneCursor = (c: { t: string; id: number }) =>
	Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeDoneCursor(raw: string): { t: string; id: number } | null {
	try {
		const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
		if (typeof c.t === 'string' && !Number.isNaN(Date.parse(c.t)) && Number.isInteger(c.id)) {
			return { t: c.t, id: c.id };
		}
	} catch {
		// fall through
	}
	return null;
}

/**
 * Resolved cases, newest resolution first. All reports closed in one resolveReports call share
 * their resolved_at, so (content, resolved_at, outcome, resolver) is one decision. An unreadable
 * cursor restarts from the top.
 */
export async function listDoneCases(
	cursor?: string
): Promise<{ cases: DoneCase[]; nextCursor: string | null }> {
	const after = cursor ? decodeDoneCursor(cursor) : null;
	const groups = await db.execute<{
		content_type: ContentType;
		content_id: number;
		resolved_at_raw: string;
		first_id: number;
		ids: number[];
	}>(sql`
		SELECT r.content_type, r.content_id, r.resolved_at::text AS resolved_at_raw,
			min(r.id)::int AS first_id, array_agg(r.id) AS ids
		FROM reports r
		WHERE r.status = 'resolved' AND r.resolved_at IS NOT NULL
		GROUP BY r.content_type, r.content_id, r.resolved_at, r.outcome, r.resolved_by
		${after ? sql`HAVING (r.resolved_at, min(r.id)) < (${after.t}::timestamptz, ${after.id}::integer)` : sql``}
		ORDER BY r.resolved_at DESC, first_id DESC
		LIMIT ${DONE_PAGE_SIZE + 1}
	`);

	const all = [...groups];
	const page = all.slice(0, DONE_PAGE_SIZE);
	const last = page[page.length - 1];
	const nextCursor =
		all.length > DONE_PAGE_SIZE
			? encodeDoneCursor({ t: last.resolved_at_raw, id: last.first_id })
			: null;

	const rows = await reportRows(page.flatMap((g) => g.ids));
	const byId = new Map(rows.map((r) => [r.id, r]));
	const authors = await authorsById([...new Set(rows.map((r) => r.authorId))]);

	const cases = page.map((g): DoneCase => {
		const mine = g.ids.map((id) => byId.get(id)!).filter(Boolean);
		const first = mine[0];
		const author = authors.get(first.authorId);
		return {
			contentType: g.content_type,
			contentId: g.content_id,
			authorId: author?.publicId ?? '',
			author: author?.username ?? '',
			authorDisplay: author?.display ?? '',
			authorRole: author?.role ?? 'member',
			excerpt: first.excerpt,
			reports: mine.map(toCaseReport),
			categories: countCategories(mine),
			id: g.first_id,
			outcome: first.outcome!,
			resolvedAt: first.resolvedAt!.toISOString(),
			resolvedBy: first.resolvedBy ?? ''
		};
	});
	return { cases, nextCursor };
}

// --- timeouts and users ----------------------------------------------------------------------

export interface ActiveTimeout {
	/** Row id of the timeout itself (not a user, meme, comment or quote id). */
	id: number;
	/** Public id of the muted user; the internal id never leaves the query. */
	publicId: string;
	username: string;
	/** Display name, null until set. */
	displayName: string | null;
	role: Role;
	reason: string;
	until: string;
	createdAt: string;
	setBy: string;
}

/** Timeouts in force right now (not lifted, not expired), longest remaining last. */
export async function listActiveTimeouts(): Promise<ActiveTimeout[]> {
	const setter = alias(users, 'setter');
	const rows = await db
		.select({
			id: timeouts.id,
			publicId: users.publicId,
			username: users.username,
			displayName: users.displayName,
			role: users.role,
			reason: timeouts.reason,
			until: timeouts.until,
			createdAt: timeouts.createdAt,
			setBy: setter.username
		})
		.from(timeouts)
		.innerJoin(users, eq(users.id, timeouts.userId))
		.innerJoin(setter, eq(setter.id, timeouts.setBy))
		.where(and(sql`${timeouts.liftedAt} IS NULL`, sql`${timeouts.until} > now()`))
		.orderBy(asc(timeouts.until), asc(timeouts.id));
	return rows.map((r) => ({
		...r,
		until: r.until.toISOString(),
		createdAt: r.createdAt.toISOString()
	}));
}

export interface UserTimeoutRecord {
	reason: string;
	until: string;
	createdAt: string;
	liftedAt: string | null;
	setBy: string;
}

export interface UserOverview {
	/** Public id of the user (API paths, links); the internal id stays inside the query. */
	publicId: string;
	username: string;
	/** Self-chosen display name, null until set. */
	displayName: string | null;
	/** Thumb key of the avatar, null when none. */
	avatarThumbKey: string | null;
	motto: string;
	role: Role;
	createdAt: string;
	memes: number;
	comments: number;
	quotes: number;
	/** Reports against this user that ended with outcome 'actioned', and the distinct contents behind them. */
	confirmedReports: number;
	confirmedCases: number;
	activeTimeout: UserTimeoutRecord | null;
	pastTimeouts: UserTimeoutRecord[];
}

/** Every known user with role, contribution counts, timeouts and confirmed reports (admin view). */
export async function listUserOverview(): Promise<UserOverview[]> {
	const rows = await db.execute<{
		id: number;
		public_id: string;
		username: string;
		display_name: string | null;
		avatar_thumb_key: string | null;
		motto: string;
		role: Role;
		created_at: Date;
		memes: number;
		comments: number;
		quotes: number;
		confirmed_reports: number;
		confirmed_cases: number;
	}>(sql`
		SELECT u.id, u.public_id, u.username, u.display_name, u.avatar_thumb_key, u.motto, u.role, u.created_at,
			(SELECT count(*)::int FROM media m WHERE m.uploader_id = u.id) AS memes,
			(SELECT count(*)::int FROM comments c WHERE c.author_id = u.id AND c.deleted_at IS NULL) AS comments,
			(SELECT count(*)::int FROM quotes q WHERE q.submitted_by = u.id) AS quotes,
			(SELECT count(*)::int FROM reports r
				WHERE r.author_id = u.id AND r.outcome = 'actioned') AS confirmed_reports,
			(SELECT count(*)::int FROM (
				SELECT 1 FROM reports r
				WHERE r.author_id = u.id AND r.outcome = 'actioned'
				GROUP BY r.content_type, r.content_id
			) k) AS confirmed_cases
		FROM users u
		ORDER BY confirmed_reports DESC, lower(u.username), u.id
	`);

	const setter = alias(users, 'setter');
	const timeoutRows = await db
		.select({
			userId: timeouts.userId,
			reason: timeouts.reason,
			until: timeouts.until,
			createdAt: timeouts.createdAt,
			liftedAt: timeouts.liftedAt,
			setBy: setter.username,
			active: sql<boolean>`(${timeouts.liftedAt} IS NULL AND ${timeouts.until} > now())`
		})
		.from(timeouts)
		.innerJoin(setter, eq(setter.id, timeouts.setBy))
		.orderBy(desc(timeouts.createdAt), desc(timeouts.id));
	const byUser = new Map<number, { active: UserTimeoutRecord | null; past: UserTimeoutRecord[] }>();
	for (const t of timeoutRows) {
		const entry = byUser.get(t.userId) ?? { active: null, past: [] };
		const record: UserTimeoutRecord = {
			reason: t.reason,
			until: t.until.toISOString(),
			createdAt: t.createdAt.toISOString(),
			liftedAt: t.liftedAt?.toISOString() ?? null,
			setBy: t.setBy
		};
		if (t.active && entry.active === null) entry.active = record;
		else entry.past.push(record);
		byUser.set(t.userId, entry);
	}

	return [...rows].map((r) => ({
		publicId: r.public_id,
		username: r.username,
		displayName: r.display_name,
		avatarThumbKey: r.avatar_thumb_key,
		motto: r.motto,
		role: r.role,
		createdAt: new Date(r.created_at).toISOString(),
		memes: r.memes,
		comments: r.comments,
		quotes: r.quotes,
		confirmedReports: r.confirmed_reports,
		confirmedCases: r.confirmed_cases,
		activeTimeout: byUser.get(r.id)?.active ?? null,
		pastTimeouts: byUser.get(r.id)?.past ?? []
	}));
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** Username search for the timeout picker (case-insensitive substring; empty = first alphabetically). */
export async function searchUsers(
	query: string,
	limit = USER_SEARCH_LIMIT
): Promise<{ publicId: string; username: string; displayName: string | null; role: Role }[]> {
	const q = query.trim().slice(0, 50);
	return db
		.select({
			publicId: users.publicId,
			username: users.username,
			displayName: users.displayName,
			role: users.role
		})
		.from(users)
		.where(q === '' ? undefined : ilike(users.username, `%${escapeLike(q)}%`))
		.orderBy(asc(sql`lower(${users.username})`), asc(users.id))
		.limit(limit);
}

/**
 * id to display name, username, role and public id for audit-log targets that point at users.
 * Unknown ids are absent.
 */
export async function namesById(
	ids: number[]
): Promise<Map<number, { display: string; username: string; role: Role; publicId: string }>> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return new Map();
	const rows = await db
		.select({
			id: users.id,
			publicId: users.publicId,
			username: users.username,
			displayName: users.displayName,
			role: users.role
		})
		.from(users)
		.where(inArray(users.id, unique));
	return new Map(
		rows.map((r) => [
			r.id,
			{
				display: r.displayName ?? r.username,
				username: r.username,
				role: r.role,
				publicId: r.publicId
			}
		])
	);
}

const TARGET_TABLES = {
	user: users,
	meme: media,
	comment: comments,
	quote: quotes,
	template: templates
} as const;

/**
 * Public ids for audit-log targets, keyed `<targetType>:<internal id>`. Only user, meme, comment, quote
 * and template targets have one; a target that no longer exists (deleted content) or has no public id
 * (site content, maintenance, season settings) is absent.
 */
export async function targetPublicIds(
	targets: { targetType: string; targetId: number }[]
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const [type, table] of Object.entries(TARGET_TABLES)) {
		const ids = [...new Set(targets.filter((t) => t.targetType === type).map((t) => t.targetId))];
		if (ids.length === 0) continue;
		const rows = await db
			.select({ id: table.id, publicId: table.publicId })
			.from(table)
			.where(inArray(table.id, ids));
		for (const r of rows) out.set(`${type}:${r.id}`, r.publicId);
	}
	return out;
}
