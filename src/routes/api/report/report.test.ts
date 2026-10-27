import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession, type SessionUser } from '../../../lib/server/auth/session';
import { db } from '../../../lib/server/db';
import { comments, media, quotes, reports } from '../../../lib/server/db/schema';
import { resetDb, setupDb, testUser } from '../../../lib/server/db/test-utils';
import { createReport, ReportError } from '../../../lib/server/moderation';
import { timeOut } from '../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../lib/server/rate-limit';
import { callRoute } from '../../../lib/server/test-request';
import { POST } from './+server';

/** Fixed far-future mute end, so the formatted date never depends on the run date. */
const MUTED_UNTIL = new Date('2099-12-24T12:00:00Z');

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

async function world() {
	const [author, reporter] = await Promise.all([testUser(), testUser()]);
	const [meme] = await db
		.insert(media)
		.values({
			uploaderId: author.id,
			title: 'Meme',
			kind: 'image',
			objectKey: 'memes/o.webp',
			thumbKey: 'memes/t.webp'
		})
		.returning({ id: media.id });
	const [comment] = await db
		.insert(comments)
		.values({ mediaId: meme.id, authorId: author.id, text: 'Kommentar' })
		.returning({ id: comments.id });
	const [quote] = await db
		.insert(quotes)
		.values({ submittedBy: author.id, text: 'Zitat', author: 'Opa' })
		.returning({ id: quotes.id });
	const asUser = (u: { id: number; username: string }): SessionUser => ({
		id: u.id,
		username: u.username,
		displayName: null,
		role: 'member'
	});
	return {
		author,
		reporter,
		authorSession: await createSession(author.id),
		reporterSession: await createSession(reporter.id),
		memeId: meme.id,
		commentId: comment.id,
		quoteId: quote.id,
		asUser
	};
}

const post = (body: unknown, session: string) =>
	callRoute({ handler: POST, path: '/api/report', method: 'POST', body, session });

describe('POST /api/report', () => {
	it('stores a report for each content type and answers 204', async () => {
		const w = await world();
		for (const [contentType, contentId] of [
			['meme', w.memeId],
			['comment', w.commentId],
			['quote', w.quoteId]
		] as const) {
			const { response } = await post(
				{ contentType, contentId, category: 'misinformation', text: ' Quatsch ' },
				w.reporterSession
			);
			expect(response.status, contentType).toBe(204);
		}
		const rows = await db.select().from(reports).where(eq(reports.reporterId, w.reporter.id));
		expect(rows.map((r) => r.contentType).sort()).toEqual(['comment', 'meme', 'quote']);
		expect(rows.every((r) => r.category === 'misinformation' && r.text === 'Quatsch')).toBe(true);
	});

	it('text is optional', async () => {
		const w = await world();
		const { response } = await post(
			{ contentType: 'meme', contentId: w.memeId, category: 'spam' },
			w.reporterSession
		);
		expect(response.status).toBe(204);
	});

	it.each([
		['unknown contentType', { contentType: 'user', category: 'spam' }],
		['prototype key as contentType', { contentType: '__proto__', category: 'spam' }],
		['non-string contentType', { contentType: 5, category: 'spam' }],
		['missing contentType', { category: 'spam' }],
		['unknown category', { contentType: 'meme', category: 'hass' }],
		['old category name', { contentType: 'meme', category: 'verletzend' }],
		['missing category', { contentType: 'meme' }],
		['non-string text', { contentType: 'meme', category: 'spam', text: 7 }],
		['over-long text', { contentType: 'meme', category: 'spam', text: 'x'.repeat(501) }]
	])('rejects %s with 400 and writes nothing', async (_name, partial) => {
		const w = await world();
		const { response } = await post({ contentId: w.memeId, ...partial }, w.reporterSession);
		expect(response.status).toBe(400);
		expect(await db.select().from(reports)).toHaveLength(0);
	});

	it.each([
		['string id', '1'],
		['zero', 0],
		['negative', -3],
		['fraction', 1.5],
		['null', null]
	])('rejects a %s contentId with 400', async (_name, contentId) => {
		const w = await world();
		const { response } = await post(
			{ contentType: 'meme', contentId, category: 'spam' },
			w.reporterSession
		);
		expect(response.status).toBe(400);
	});

	it('rejects a non-JSON body with 400', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: POST,
			path: '/api/report',
			method: 'POST',
			session: w.reporterSession
		});
		expect(response.status).toBe(400);
	});

	it('maps own content to 400, duplicate to 409, missing content to 404', async () => {
		const w = await world();
		const own = await post(
			{ contentType: 'meme', contentId: w.memeId, category: 'spam' },
			w.authorSession
		);
		expect(own.response.status).toBe(400);

		const body = { contentType: 'comment', contentId: w.commentId, category: 'spam' };
		expect((await post(body, w.reporterSession)).response.status).toBe(204);
		expect((await post(body, w.reporterSession)).response.status).toBe(409);

		const missing = await post(
			{ contentType: 'quote', contentId: 999999, category: 'spam' },
			w.reporterSession
		);
		expect(missing.response.status).toBe(404);
	});

	it('maps an author-less quote (unreportable) to 404', async () => {
		const w = await world();
		const [orphan] = await db
			.insert(quotes)
			.values({ submittedBy: null, text: 'alt', author: 'x' })
			.returning({ id: quotes.id });
		const { response } = await post(
			{ contentType: 'quote', contentId: orphan.id, category: 'spam' },
			w.reporterSession
		);
		expect(response.status).toBe(404);
	});

	it('rejects a timed-out reporter with the 403', async () => {
		const w = await world();
		await timeOut(w.reporter.id, w.author.id, MUTED_UNTIL);
		const { response } = await post(
			{ contentType: 'meme', contentId: w.memeId, category: 'spam' },
			w.reporterSession
		);
		expect(response.status).toBe(403);
		expect(await response.text()).toBe('You are muted until 24 Dec 2099: test');
	});

	it('requires a session', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: POST,
			path: '/api/report',
			method: 'POST',
			body: { contentType: 'meme', contentId: w.memeId, category: 'spam' }
		});
		expect(response.status).toBe(401);
	});
});

describe('createReport concurrency', () => {
	it('two simultaneous reports by the same user: exactly one succeeds, the other is a duplicate', async () => {
		const w = await world();
		const results = await Promise.allSettled([
			createReport(w.asUser(w.reporter), 'meme', w.memeId, 'spam'),
			createReport(w.asUser(w.reporter), 'meme', w.memeId, 'spam')
		]);
		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reason).toBeInstanceOf(ReportError);
		expect((rejected[0].reason as ReportError).code).toBe('duplicate');
		expect(
			await db
				.select()
				.from(reports)
				.where(and(eq(reports.reporterId, w.reporter.id), eq(reports.contentId, w.memeId)))
		).toHaveLength(1);
	});

	it('many simultaneous reports by the same user still leave one row', async () => {
		const w = await world();
		const results = await Promise.allSettled(
			Array.from({ length: 6 }, () =>
				createReport(w.asUser(w.reporter), 'quote', w.quoteId, 'spam')
			)
		);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(await db.select().from(reports)).toHaveLength(1);
	});

	it('two different users reporting simultaneously both succeed', async () => {
		const w = await world();
		const second = await testUser();
		const results = await Promise.allSettled([
			createReport(w.asUser(w.reporter), 'meme', w.memeId, 'spam'),
			createReport(w.asUser(second), 'meme', w.memeId, 'spam')
		]);
		expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
		expect(await db.select().from(reports)).toHaveLength(2);
	});
});
