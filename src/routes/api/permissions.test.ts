import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../../lib/server/auth/session';
import { addComment } from '../../lib/server/comments';
import { db } from '../../lib/server/db';
import { comments, media, quotes } from '../../lib/server/db/schema';
import { resetDb, setupDb, testUser } from '../../lib/server/db/test-utils';
import { addQuote } from '../../lib/server/quotes';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { callRoute } from '../../lib/server/test-request';
import { DELETE as deleteComment } from './comments/[id]/+server';
import { DELETE as deleteMeme, PATCH as patchMeme } from './memes/[id]/+server';
import { POST as voteMeme } from './memes/[id]/vote/+server';
import { DELETE as deleteQuote } from './quotes/[id]/+server';
import { POST as voteQuote } from './quotes/[id]/vote/+server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

/** Owner (member), a second member, a moderator, plus a meme, comment and quote of the owner. */
async function world() {
	const [owner, other, mod] = await Promise.all([
		testUser({ role: 'member' }),
		testUser({ role: 'member' }),
		testUser({ role: 'moderator' })
	]);
	const sessions = {
		owner: await createSession(owner.id),
		other: await createSession(other.id),
		mod: await createSession(mod.id)
	};
	// unique keys: moderator deletion also removes the bucket objects
	const key = `memes/utest/${crypto.randomUUID()}`;
	const [meme] = await db
		.insert(media)
		.values({
			uploaderId: owner.id,
			title: 'm',
			kind: 'image',
			objectKey: `${key}.webp`,
			thumbKey: `${key}-thumb.webp`
		})
		.returning({ id: media.id });
	const comment = await addComment(owner.id, meme.id, 'hallo');
	const quote = await addQuote(owner.id, 'Zitat', 'Opa');
	return { sessions, memeId: meme.id, commentId: comment.id, quoteId: quote.id };
}

const MISSING = '999999';

describe('DELETE /api/comments/[id]', () => {
	it('forbids a member from deleting a foreign comment (403) and keeps it', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${w.commentId}`,
			method: 'DELETE',
			params: { id: String(w.commentId) },
			session: w.sessions.other
		});
		expect(response.status).toBe(403);
		expect(await db.select().from(comments).where(eq(comments.id, w.commentId))).toHaveLength(1);
	});

	it('lets the author and a moderator delete', async () => {
		const w = await world();
		const own = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${w.commentId}`,
			method: 'DELETE',
			params: { id: String(w.commentId) },
			session: w.sessions.owner
		});
		expect(own.response.status).toBe(204);

		const again = await world();
		const mod = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${again.commentId}`,
			method: 'DELETE',
			params: { id: String(again.commentId) },
			session: again.sessions.mod
		});
		expect(mod.response.status).toBe(204);
		expect(await db.select().from(comments).where(eq(comments.id, again.commentId))).toHaveLength(
			0
		);
	});

	it('answers 404 for a missing comment', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${MISSING}`,
			method: 'DELETE',
			params: { id: MISSING },
			session: w.sessions.mod
		});
		expect(response.status).toBe(404);
	});
});

describe('DELETE/PATCH /api/memes/[id]', () => {
	it('forbids a member from deleting a foreign meme (403) and keeps it', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${w.memeId}`,
			method: 'DELETE',
			params: { id: String(w.memeId) },
			session: w.sessions.other
		});
		expect(response.status).toBe(403);
		expect(await db.select().from(media).where(eq(media.id, w.memeId))).toHaveLength(1);
	});

	it('forbids a member from flagging a foreign meme (403) and leaves the flags alone', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: patchMeme,
			path: `/api/memes/${w.memeId}`,
			method: 'PATCH',
			params: { id: String(w.memeId) },
			body: { nsfw: true },
			session: w.sessions.other
		});
		expect(response.status).toBe(403);
		const [row] = await db.select().from(media).where(eq(media.id, w.memeId));
		expect(row.nsfw).toBe(false);
	});

	it('lets a moderator flag (204) and delete (204) a foreign meme', async () => {
		const w = await world();
		const patched = await callRoute({
			handler: patchMeme,
			path: `/api/memes/${w.memeId}`,
			method: 'PATCH',
			params: { id: String(w.memeId) },
			body: { nsfw: true },
			session: w.sessions.mod
		});
		expect(patched.response.status).toBe(204);
		const [row] = await db.select().from(media).where(eq(media.id, w.memeId));
		expect(row.nsfw).toBe(true);

		const deleted = await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${w.memeId}`,
			method: 'DELETE',
			params: { id: String(w.memeId) },
			session: w.sessions.mod
		});
		expect(deleted.response.status).toBe(204);
		expect(await db.select().from(media).where(eq(media.id, w.memeId))).toHaveLength(0);
	});

	it('lets the uploader delete their own meme', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${w.memeId}`,
			method: 'DELETE',
			params: { id: String(w.memeId) },
			session: w.sessions.owner
		});
		expect(response.status).toBe(204);
	});

	it('answers 404 for a missing meme', async () => {
		const w = await world();
		const del = await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${MISSING}`,
			method: 'DELETE',
			params: { id: MISSING },
			session: w.sessions.mod
		});
		expect(del.response.status).toBe(404);
		const patch = await callRoute({
			handler: patchMeme,
			path: `/api/memes/${MISSING}`,
			method: 'PATCH',
			params: { id: MISSING },
			body: { spoiler: true },
			session: w.sessions.mod
		});
		expect(patch.response.status).toBe(404);
	});
});

describe('DELETE /api/quotes/[id]', () => {
	it('forbids a member from deleting a quote (403), even their own', async () => {
		const w = await world();
		for (const session of [w.sessions.other, w.sessions.owner]) {
			const { response } = await callRoute({
				handler: deleteQuote,
				path: `/api/quotes/${w.quoteId}`,
				method: 'DELETE',
				params: { id: String(w.quoteId) },
				session
			});
			expect(response.status).toBe(403);
		}
		expect(await db.select().from(quotes).where(eq(quotes.id, w.quoteId))).toHaveLength(1);
	});

	it('lets a moderator delete (204)', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteQuote,
			path: `/api/quotes/${w.quoteId}`,
			method: 'DELETE',
			params: { id: String(w.quoteId) },
			session: w.sessions.mod
		});
		expect(response.status).toBe(204);
		expect(await db.select().from(quotes).where(eq(quotes.id, w.quoteId))).toHaveLength(0);
	});

	it('answers 404 for a missing quote', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteQuote,
			path: `/api/quotes/${MISSING}`,
			method: 'DELETE',
			params: { id: MISSING },
			session: w.sessions.mod
		});
		expect(response.status).toBe(404);
	});
});

describe('vote endpoints', () => {
	const invalid = [2, -2, '1', null, true, 0.5];

	it.each(invalid)('rejects the invalid meme vote value %j with 400', async (value) => {
		const w = await world();
		const { response } = await callRoute({
			handler: voteMeme,
			path: `/api/memes/${w.memeId}/vote`,
			method: 'POST',
			params: { id: String(w.memeId) },
			body: { value },
			session: w.sessions.other
		});
		expect(response.status).toBe(400);
	});

	it('rejects a missing value and a non-object body with 400', async () => {
		const w = await world();
		for (const body of [{}, null, 'up']) {
			const { response } = await callRoute({
				handler: voteMeme,
				path: `/api/memes/${w.memeId}/vote`,
				method: 'POST',
				params: { id: String(w.memeId) },
				body,
				session: w.sessions.other
			});
			expect(response.status).toBe(400);
		}
	});

	it('rejects an invalid quote vote value with 400', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: voteQuote,
			path: `/api/quotes/${w.quoteId}/vote`,
			method: 'POST',
			params: { id: String(w.quoteId) },
			body: { value: 5 },
			session: w.sessions.other
		});
		expect(response.status).toBe(400);
	});

	it('accepts 1, -1 and 0, and answers 404 for a missing meme', async () => {
		const w = await world();
		for (const value of [1, -1, 0]) {
			const { response } = await callRoute({
				handler: voteMeme,
				path: `/api/memes/${w.memeId}/vote`,
				method: 'POST',
				params: { id: String(w.memeId) },
				body: { value },
				session: w.sessions.other
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ userVote: value });
		}
		const missing = await callRoute({
			handler: voteMeme,
			path: `/api/memes/${MISSING}/vote`,
			method: 'POST',
			params: { id: MISSING },
			body: { value: 1 },
			session: w.sessions.other
		});
		expect(missing.response.status).toBe(404);
	});
});

describe('auth guard in front of the routes', () => {
	it('answers 401 without a session and never reaches the handler', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${w.commentId}`,
			method: 'DELETE',
			params: { id: String(w.commentId) }
		});
		expect(response.status).toBe(401);
		expect(await db.select().from(comments).where(eq(comments.id, w.commentId))).toHaveLength(1);
	});
});
