import { createSession, type SessionUser } from './auth/session';
import { db } from './db';
import { comments, media, quotes, reports, timeouts } from './db/schema';
import { testUser } from './db/test-utils';
import { env } from './env';
import type { ContentType } from './moderation';

/** Inserts `n` open reports on a content item, each from a fresh distinct reporter. Returns the reporter ids. */
export async function addOpenReports(
	contentType: ContentType,
	contentId: number,
	authorId: number,
	n: number
): Promise<number[]> {
	const reporterIds: number[] = [];
	for (let i = 0; i < n; i++) {
		const reporter = await testUser();
		reporterIds.push(reporter.id);
		await db.insert(reports).values({
			contentType,
			contentId,
			reporterId: reporter.id,
			authorId,
			category: 'spam',
			excerpt: 'x'
		});
	}
	return reporterIds;
}

/** Reports needed to push content strictly above the review threshold. */
export const OVER_THRESHOLD = env.REPORT_REVIEW_THRESHOLD + 1;

/** Gives a user an active timeout (setBy any user id). */
export async function timeOut(
	userId: number,
	setBy: number,
	until: Date = new Date(Date.now() + 86_400_000)
): Promise<void> {
	await db.insert(timeouts).values({
		userId,
		setBy,
		reason: 'test',
		until
	});
}

/** A fresh user with the given role, a live session cookie value and the user's public id. */
export async function userWithSession(role: SessionUser['role'] = 'member') {
	const u = await testUser({ role });
	const user: SessionUser = { id: u.id, username: u.username, displayName: u.displayName, role };
	return { user, session: await createSession(u.id), publicId: u.publicId };
}

/** Inserts a meme row (fake object keys, nothing in the bucket) and returns its ids. */
export async function insertMemeRow(
	uploaderId: number,
	title = 'Testmeme'
): Promise<{ id: number; publicId: string }> {
	const key = `memes/utest/${crypto.randomUUID()}`;
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title,
			kind: 'image',
			objectKey: `${key}.webp`,
			thumbKey: `${key}-t.webp`
		})
		.returning({ id: media.id, publicId: media.publicId });
	return row;
}

/** Inserts a meme row and returns its internal id. */
export async function insertMeme(uploaderId: number, title = 'Testmeme'): Promise<number> {
	return (await insertMemeRow(uploaderId, title)).id;
}

export async function insertCommentRow(
	authorId: number,
	mediaId: number,
	text = 'Kommentar'
): Promise<{ id: number; publicId: string }> {
	const [row] = await db
		.insert(comments)
		.values({ authorId, mediaId, text })
		.returning({ id: comments.id, publicId: comments.publicId });
	return row;
}

export async function insertComment(authorId: number, mediaId: number, text = 'Kommentar') {
	return (await insertCommentRow(authorId, mediaId, text)).id;
}

export async function insertQuoteRow(
	submittedBy: number,
	text = 'Zitat'
): Promise<{ id: number; publicId: string }> {
	const [row] = await db
		.insert(quotes)
		.values({ submittedBy, text, author: 'Opa' })
		.returning({ id: quotes.id, publicId: quotes.publicId });
	return row;
}

export async function insertQuote(submittedBy: number, text = 'Zitat'): Promise<number> {
	return (await insertQuoteRow(submittedBy, text)).id;
}
