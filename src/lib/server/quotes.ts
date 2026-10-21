import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { quoteVotes, quotes } from './db/schema';
import { assertNotTimedOut, underReviewSql } from './moderation';
import type { SessionUser } from './auth/session';
import type { VoteValue } from './votes';

export const MAX_QUOTE_LENGTH = 500;
export const MAX_AUTHOR_LENGTH = 100;

export class QuoteTextError extends Error {
	constructor() {
		super(`Quote must be 1-${MAX_QUOTE_LENGTH} characters, author 1-${MAX_AUTHOR_LENGTH}`);
	}
}
export class QuoteNotFoundError extends Error {
	constructor() {
		super('Quote not found');
	}
}
export class QuotePermissionError extends Error {
	constructor() {
		super('Only moderators may delete quotes');
	}
}

export interface QuoteItem {
	id: number;
	/** null while under review, for viewers who may not see it (author is then blanked too). */
	text: string | null;
	author: string;
	underReview: boolean;
	/** The viewer submitted this quote (never offer "Melden" on it). */
	mine: boolean;
	createdAt: string;
	score: number;
	userVote: VoteValue;
}

/** Score is the aggregate of quote_votes; there is no cached column. */
const scoreSql = sql<number>`coalesce((select sum(${quoteVotes.value}) from ${quoteVotes} where ${quoteVotes.quoteId} = ${quotes.id}), 0)::int`;
const userVoteSql = (userId: number) =>
	sql<number>`coalesce((select ${quoteVotes.value} from ${quoteVotes} where ${quoteVotes.quoteId} = ${quotes.id} and ${quoteVotes.userId} = ${userId}), 0)::int`;

const columns = (userId: number) => ({
	id: quotes.id,
	text: quotes.text,
	author: quotes.author,
	underReview: underReviewSql('quote', quotes.id, quotes.reviewedAt),
	mine: sql<boolean>`coalesce(${quotes.submittedBy} = ${userId}, false)`,
	createdAt: quotes.createdAt,
	score: scoreSql,
	userVote: userVoteSql(userId)
});

const toItem = (r: {
	id: number;
	text: string;
	author: string;
	underReview: boolean;
	mine: boolean;
	createdAt: Date;
	score: number;
	userVote: number;
}): QuoteItem => ({
	...r,
	createdAt: r.createdAt.toISOString(),
	userVote: r.userVote as VoteValue
});

/** All quotes, newest first, with the viewer's own vote. Under-review text is nulled unless `revealAll`. */
export async function listQuotes(userId: number, revealAll = false): Promise<QuoteItem[]> {
	const rows = await db
		.select(columns(userId))
		.from(quotes)
		.orderBy(desc(quotes.createdAt), desc(quotes.id));
	return rows.map((r) => {
		const item = toItem(r);
		return item.underReview && !revealAll ? { ...item, text: null, author: '' } : item;
	});
}

export async function addQuote(userId: number, text: string, author: string): Promise<QuoteItem> {
	const t = text.trim();
	const a = author.trim();
	if (t.length < 1 || t.length > MAX_QUOTE_LENGTH) throw new QuoteTextError();
	if (a.length < 1 || a.length > MAX_AUTHOR_LENGTH) throw new QuoteTextError();
	await assertNotTimedOut({ id: userId });
	const [inserted] = await db
		.insert(quotes)
		.values({ text: t, author: a, submittedBy: userId })
		.returning({ id: quotes.id });
	const [row] = await db.select(columns(userId)).from(quotes).where(eq(quotes.id, inserted.id));
	return toItem(row);
}

/** Sets the user's vote (0 clears it) and returns the aggregated score. */
export async function voteQuote(
	userId: number,
	quoteId: number,
	value: VoteValue
): Promise<{ score: number; userVote: VoteValue }> {
	await assertNotTimedOut({ id: userId });
	return db.transaction(async (tx) => {
		const [q] = await tx
			.select({ id: quotes.id })
			.from(quotes)
			.where(eq(quotes.id, quoteId))
			.for('update');
		if (!q) throw new QuoteNotFoundError();
		if (value === 0) {
			await tx
				.delete(quoteVotes)
				.where(and(eq(quoteVotes.userId, userId), eq(quoteVotes.quoteId, quoteId)));
		} else {
			await tx
				.insert(quoteVotes)
				.values({ userId, quoteId, value })
				.onConflictDoUpdate({ target: [quoteVotes.userId, quoteVotes.quoteId], set: { value } });
		}
		const [{ score }] = await tx
			.select({ score: sql<number>`coalesce(sum(${quoteVotes.value}), 0)::int` })
			.from(quoteVotes)
			.where(eq(quoteVotes.quoteId, quoteId));
		return { score, userVote: value };
	});
}

/** Moderators and admins only (old-app rule); votes cascade. */
export async function deleteQuote(user: SessionUser, quoteId: number): Promise<void> {
	if (user.role !== 'moderator' && user.role !== 'admin') throw new QuotePermissionError();
	const [q] = await db
		.select({ submittedBy: quotes.submittedBy })
		.from(quotes)
		.where(eq(quotes.id, quoteId));
	if (!q) throw new QuoteNotFoundError();
	// Own quotes may always be removed; moderating others' is suspended by a timeout.
	if (q.submittedBy !== user.id) await assertNotTimedOut(user);
	const deleted = await db
		.delete(quotes)
		.where(eq(quotes.id, quoteId))
		.returning({ id: quotes.id });
	if (deleted.length === 0) throw new QuoteNotFoundError();
}
