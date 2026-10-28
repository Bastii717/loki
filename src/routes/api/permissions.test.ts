import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../../lib/server/auth/session';
import { db } from '../../lib/server/db';
import { comments, media, quotes } from '../../lib/server/db/schema';
import { resetDb, setupDb, testUser } from '../../lib/server/db/test-utils';
import { insertCommentRow, insertQuoteRow } from '../../lib/server/moderation-test-utils';
import { ensureBucket } from '../../lib/server/storage-test-utils';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { callRoute } from '../../lib/server/test-request';
import { DELETE as deleteComment } from './comments/[pid]/+server';
import { DELETE as deleteMeme, PATCH as patchMeme } from './memes/[pid]/+server';
import { GET as getMemeComments, POST as postMemeComment } from './memes/[pid]/comments/+server';
import { POST as favoriteMeme } from './memes/[pid]/favorite/+server';
import { POST as seenMeme } from './memes/[pid]/seen/+server';
import { GET as memeSource } from './memes/[pid]/source/+server';
import { POST as voteMeme } from './memes/[pid]/vote/+server';
import { DELETE as deleteQuote } from './quotes/[pid]/+server';
import { POST as voteQuote } from './quotes/[pid]/vote/+server';

// moderator/uploader deletion removes the bucket objects, so the bucket must exist (fresh CI MinIO)
beforeAll(async () => {
	await setupDb();
	await ensureBucket();
});
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
		.returning({ id: media.id, publicId: media.publicId });
	const comment = await insertCommentRow(owner.id, meme.id, 'hallo');
	const quote = await insertQuoteRow(owner.id, 'Zitat');
	return {
		sessions,
		memeId: meme.id,
		memePid: meme.publicId,
		commentId: comment.id,
		commentPid: comment.publicId,
		quoteId: quote.id,
		quotePid: quote.publicId
	};
}

/** Well-formed, but nobody's public id. */
const MISSING = 'AAAAAAAAAAAA';

describe('DELETE /api/comments/[pid]', () => {
	it('forbids a member from deleting a foreign comment (403) and keeps it', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${w.commentPid}`,
			method: 'DELETE',
			params: { pid: w.commentPid },
			session: w.sessions.other
		});
		expect(response.status).toBe(403);
		expect(await db.select().from(comments).where(eq(comments.id, w.commentId))).toHaveLength(1);
	});

	it('lets the author and a moderator delete', async () => {
		const w = await world();
		const own = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${w.commentPid}`,
			method: 'DELETE',
			params: { pid: w.commentPid },
			session: w.sessions.owner
		});
		expect(own.response.status).toBe(204);

		const again = await world();
		const mod = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${again.commentPid}`,
			method: 'DELETE',
			params: { pid: again.commentPid },
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
			params: { pid: MISSING },
			session: w.sessions.mod
		});
		expect(response.status).toBe(404);
	});
});

describe('DELETE/PATCH /api/memes/[pid]', () => {
	it('forbids a member from deleting a foreign meme (403) and keeps it', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${w.memePid}`,
			method: 'DELETE',
			params: { pid: w.memePid },
			session: w.sessions.other
		});
		expect(response.status).toBe(403);
		expect(await db.select().from(media).where(eq(media.id, w.memeId))).toHaveLength(1);
	});

	it('forbids a member from flagging a foreign meme (403) and leaves the flags alone', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: patchMeme,
			path: `/api/memes/${w.memePid}`,
			method: 'PATCH',
			params: { pid: w.memePid },
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
			path: `/api/memes/${w.memePid}`,
			method: 'PATCH',
			params: { pid: w.memePid },
			body: { nsfw: true },
			session: w.sessions.mod
		});
		expect(patched.response.status).toBe(204);
		const [row] = await db.select().from(media).where(eq(media.id, w.memeId));
		expect(row.nsfw).toBe(true);

		const deleted = await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${w.memePid}`,
			method: 'DELETE',
			params: { pid: w.memePid },
			session: w.sessions.mod
		});
		expect(deleted.response.status).toBe(204);
		expect(await db.select().from(media).where(eq(media.id, w.memeId))).toHaveLength(0);
	});

	it('lets the uploader delete their own meme', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${w.memePid}`,
			method: 'DELETE',
			params: { pid: w.memePid },
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
			params: { pid: MISSING },
			session: w.sessions.mod
		});
		expect(del.response.status).toBe(404);
		const patch = await callRoute({
			handler: patchMeme,
			path: `/api/memes/${MISSING}`,
			method: 'PATCH',
			params: { pid: MISSING },
			body: { spoiler: true },
			session: w.sessions.mod
		});
		expect(patch.response.status).toBe(404);
	});
});

describe('DELETE /api/quotes/[pid]', () => {
	it('forbids a member from deleting a quote (403), even their own', async () => {
		const w = await world();
		for (const session of [w.sessions.other, w.sessions.owner]) {
			const { response } = await callRoute({
				handler: deleteQuote,
				path: `/api/quotes/${w.quotePid}`,
				method: 'DELETE',
				params: { pid: w.quotePid },
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
			path: `/api/quotes/${w.quotePid}`,
			method: 'DELETE',
			params: { pid: w.quotePid },
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
			params: { pid: MISSING },
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
			path: `/api/memes/${w.memePid}/vote`,
			method: 'POST',
			params: { pid: w.memePid },
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
				path: `/api/memes/${w.memePid}/vote`,
				method: 'POST',
				params: { pid: w.memePid },
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
			path: `/api/quotes/${w.quotePid}/vote`,
			method: 'POST',
			params: { pid: w.quotePid },
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
				path: `/api/memes/${w.memePid}/vote`,
				method: 'POST',
				params: { pid: w.memePid },
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
			params: { pid: MISSING },
			body: { value: 1 },
			session: w.sessions.other
		});
		expect(missing.response.status).toBe(404);
	});
});

describe('POST /api/memes/[pid]/seen', () => {
	const seen = (memeId: string, session: string) =>
		callRoute({
			handler: seenMeme,
			path: `/api/memes/${memeId}/seen`,
			method: 'POST',
			params: { pid: memeId },
			session
		});

	it('answers {counted:true} for a first view and {counted:false} for a repeat', async () => {
		const w = await world();
		const first = await seen(w.memePid, w.sessions.other);
		expect(first.response.status).toBe(200);
		expect(await first.response.json()).toEqual({ counted: true });
		const second = await seen(w.memePid, w.sessions.other);
		expect(second.response.status).toBe(200);
		expect(await second.response.json()).toEqual({ counted: false });
		// a different viewer still counts
		const other = await seen(w.memePid, w.sessions.mod);
		expect(await other.response.json()).toEqual({ counted: true });
	});

	it('answers 404 for a missing meme', async () => {
		const w = await world();
		expect((await seen(MISSING, w.sessions.other)).response.status).toBe(404);
	});
});

describe('auth guard in front of the routes', () => {
	it('answers 401 without a session and never reaches the handler', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${w.commentPid}`,
			method: 'DELETE',
			params: { pid: w.commentPid }
		});
		expect(response.status).toBe(401);
		expect(await db.select().from(comments).where(eq(comments.id, w.commentId))).toHaveLength(1);
	});
});

describe('the renamed meme, comment and quote routes only know public ids', () => {
	const routes = [
		{
			name: 'DELETE /api/comments/[pid]',
			handler: deleteComment,
			base: 'comments',
			method: 'DELETE'
		},
		{ name: 'DELETE /api/memes/[pid]', handler: deleteMeme, base: 'memes', method: 'DELETE' },
		{ name: 'DELETE /api/quotes/[pid]', handler: deleteQuote, base: 'quotes', method: 'DELETE' },
		{
			name: 'POST /api/quotes/[pid]/vote',
			handler: voteQuote,
			base: 'quotes',
			suffix: '/vote',
			method: 'POST',
			body: { value: 1 }
		},
		{
			name: 'PATCH /api/memes/[pid]',
			handler: patchMeme,
			base: 'memes',
			method: 'PATCH',
			body: { nsfw: true }
		},
		{
			name: 'POST /api/memes/[pid]/vote',
			handler: voteMeme,
			base: 'memes',
			suffix: '/vote',
			method: 'POST',
			body: { value: 1 }
		},
		{
			name: 'POST /api/memes/[pid]/favorite',
			handler: favoriteMeme,
			base: 'memes',
			suffix: '/favorite',
			method: 'POST'
		},
		{
			name: 'POST /api/memes/[pid]/seen',
			handler: seenMeme,
			base: 'memes',
			suffix: '/seen',
			method: 'POST'
		},
		{
			name: 'GET /api/memes/[pid]/comments',
			handler: getMemeComments,
			base: 'memes',
			suffix: '/comments',
			method: 'GET'
		},
		{
			name: 'POST /api/memes/[pid]/comments',
			handler: postMemeComment,
			base: 'memes',
			suffix: '/comments',
			method: 'POST',
			body: { text: 'hi' }
		},
		{
			name: 'GET /api/memes/[pid]/source',
			handler: memeSource,
			base: 'memes',
			suffix: '/source',
			method: 'GET'
		}
	] as const;

	// the numeric internal id of a real row is the most tempting wrong answer
	it.each(routes)(
		'$name answers 404 for 1, abc, an unknown id and the real internal id',
		async (route) => {
			const w = await world();
			const real =
				route.base === 'comments' ? w.commentId : route.base === 'quotes' ? w.quoteId : w.memeId;
			for (const pid of ['1', 'abc', 'AAAAAAAAAAA', 'AAAAAAAAAAAAA', String(real), MISSING]) {
				const { response } = await callRoute({
					handler: route.handler,
					path: `/api/${route.base}/${pid}${'suffix' in route ? route.suffix : ''}`,
					method: route.method,
					params: { pid },
					body: 'body' in route ? route.body : undefined,
					session: w.sessions.mod
				});
				expect(response.status, `${route.name} ${pid}`).toBe(404);
			}
		}
	);

	it('leaves the rows alone after those 404s', async () => {
		const w = await world();
		await callRoute({
			handler: deleteMeme,
			path: `/api/memes/${w.memeId}`,
			method: 'DELETE',
			params: { pid: String(w.memeId) },
			session: w.sessions.mod
		});
		await callRoute({
			handler: deleteComment,
			path: `/api/comments/${w.commentId}`,
			method: 'DELETE',
			params: { pid: String(w.commentId) },
			session: w.sessions.mod
		});
		await callRoute({
			handler: deleteQuote,
			path: `/api/quotes/${w.quoteId}`,
			method: 'DELETE',
			params: { pid: String(w.quoteId) },
			session: w.sessions.mod
		});
		expect(await db.select().from(media).where(eq(media.id, w.memeId))).toHaveLength(1);
		expect(await db.select().from(comments).where(eq(comments.id, w.commentId))).toHaveLength(1);
		expect(await db.select().from(quotes).where(eq(quotes.id, w.quoteId))).toHaveLength(1);
	});

	it('the public id of the row works where its numeric id did not', async () => {
		const w = await world();
		const { response } = await callRoute({
			handler: voteMeme,
			path: `/api/memes/${w.memePid}/vote`,
			method: 'POST',
			params: { pid: w.memePid },
			body: { value: 1 },
			session: w.sessions.other
		});
		expect(response.status).toBe(200);
	});
});
