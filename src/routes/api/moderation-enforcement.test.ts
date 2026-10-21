import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession, type SessionUser } from '../../lib/server/auth/session';
import { addComment, markSeen } from '../../lib/server/comments';
import { db } from '../../lib/server/db';
import {
	comments,
	favorites,
	media,
	quotes,
	reports,
	timeouts,
	votes
} from '../../lib/server/db/schema';
import { resetDb, setupDb, testUser } from '../../lib/server/db/test-utils';
import { createMedia } from '../../lib/server/media/create';
import { TimeoutActiveError } from '../../lib/server/moderation';
import { timeOut } from '../../lib/server/moderation-test-utils';
import { addQuote } from '../../lib/server/quotes';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { ensureBucket } from '../../lib/server/storage-test-utils';
import { callRoute, type RouteResult } from '../../lib/server/test-request';
import { actions as quoteActions } from '../quotes/+page.server';
import { actions as uploadActions } from '../upload/+page.server';
import { GET as feed } from './feed/+server';
import { GET as discover } from './discover/+server';
import { DELETE as deleteComment } from './comments/[id]/+server';
import { GET as getComments, POST as postComment } from './memes/[id]/comments/+server';
import { DELETE as deleteMeme, PATCH as patchMeme } from './memes/[id]/+server';
import { POST as favoriteMeme } from './memes/[id]/favorite/+server';
import { POST as seenMeme } from './memes/[id]/seen/+server';
import { POST as voteMeme } from './memes/[id]/vote/+server';
import { POST as voteQuote } from './quotes/[id]/vote/+server';
import { POST as report } from './report/+server';
import { GET as suggestTags } from './tags/suggest/+server';

beforeAll(async () => {
	await setupDb();
	await ensureBucket(); // own-meme delete removes bucket objects
});
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

// far in the future so the fixture never expires, and a fixed date to assert the German format
const UNTIL = new Date('2099-12-24T12:00:00Z');
const REASON = 'Beleidigungen im Chat';
const BLOCK_MESSAGE = `Du bist bis zum 24.12.2099 stummgeschaltet: ${REASON}`;

async function timedOutWorld() {
	const [victim, author, mod] = await Promise.all([
		testUser(),
		testUser(),
		testUser({ role: 'moderator' })
	]);
	const key = `memes/utest/${crypto.randomUUID()}`;
	const [foreign, own] = await db
		.insert(media)
		.values([
			{
				uploaderId: author.id,
				title: 'fremd',
				kind: 'image',
				objectKey: `${key}-a.webp`,
				thumbKey: `${key}-a-t.webp`
			},
			{
				uploaderId: victim.id,
				title: 'eigen',
				kind: 'image',
				objectKey: `${key}-b.webp`,
				thumbKey: `${key}-b-t.webp`
			}
		])
		.returning({ id: media.id });
	const foreignComment = await addComment(author.id, foreign.id, 'Kommentar');
	const ownComment = await addComment(victim.id, foreign.id, 'mein Kommentar');
	const foreignQuote = await addQuote(author.id, 'Zitat', 'Opa');
	// last: the fixtures above are written through modules that honour the timeout
	await db
		.insert(timeouts)
		.values({ userId: victim.id, setBy: mod.id, reason: REASON, until: UNTIL });
	return {
		victim,
		session: await createSession(victim.id),
		foreignMemeId: foreign.id,
		ownMemeId: own.id,
		foreignCommentId: foreignComment.id,
		ownCommentId: ownComment.id,
		foreignQuoteId: foreignQuote.id
	};
}
type World = Awaited<ReturnType<typeof timedOutWorld>>;

interface Call {
	handler: Parameters<typeof callRoute>[0]['handler'];
	path: string;
	method?: string;
	params?: Record<string, string>;
	body?: unknown;
}

const blocked: [string, (w: World) => Call][] = [
	[
		'POST comment',
		(w) => ({
			handler: postComment,
			path: `/api/memes/${w.foreignMemeId}/comments`,
			method: 'POST',
			params: { id: String(w.foreignMemeId) },
			body: { text: 'hallo' }
		})
	],
	[
		'POST meme vote',
		(w) => ({
			handler: voteMeme,
			path: `/api/memes/${w.foreignMemeId}/vote`,
			method: 'POST',
			params: { id: String(w.foreignMemeId) },
			body: { value: 1 }
		})
	],
	[
		'POST quote vote',
		(w) => ({
			handler: voteQuote,
			path: `/api/quotes/${w.foreignQuoteId}/vote`,
			method: 'POST',
			params: { id: String(w.foreignQuoteId) },
			body: { value: 1 }
		})
	],
	[
		'POST favorite',
		(w) => ({
			handler: favoriteMeme,
			path: `/api/memes/${w.foreignMemeId}/favorite`,
			method: 'POST',
			params: { id: String(w.foreignMemeId) }
		})
	],
	[
		'PATCH own flags',
		(w) => ({
			handler: patchMeme,
			path: `/api/memes/${w.ownMemeId}`,
			method: 'PATCH',
			params: { id: String(w.ownMemeId) },
			body: { nsfw: true }
		})
	],
	[
		'POST report',
		(w) => ({
			handler: report,
			path: '/api/report',
			method: 'POST',
			body: { contentType: 'meme', contentId: w.foreignMemeId, category: 'spam' }
		})
	]
];

const allowed: [string, (w: World) => Call, number][] = [
	[
		'POST seen (markSeen)',
		(w) => ({
			handler: seenMeme,
			path: `/api/memes/${w.foreignMemeId}/seen`,
			method: 'POST',
			params: { id: String(w.foreignMemeId) }
		}),
		200
	],
	[
		'DELETE own comment',
		(w) => ({
			handler: deleteComment,
			path: `/api/comments/${w.ownCommentId}`,
			method: 'DELETE',
			params: { id: String(w.ownCommentId) }
		}),
		204
	],
	[
		'DELETE own meme',
		(w) => ({
			handler: deleteMeme,
			path: `/api/memes/${w.ownMemeId}`,
			method: 'DELETE',
			params: { id: String(w.ownMemeId) }
		}),
		204
	],
	['GET feed', () => ({ handler: feed, path: '/api/feed' }), 200],
	['GET discover', () => ({ handler: discover, path: '/api/discover' }), 200],
	[
		'GET comments',
		(w) => ({
			handler: getComments,
			path: `/api/memes/${w.foreignMemeId}/comments`,
			params: { id: String(w.foreignMemeId) }
		}),
		200
	],
	['GET tag suggest', () => ({ handler: suggestTags, path: '/api/tags/suggest?q=ab' }), 200]
];

const run = (call: Call, session: string): Promise<RouteResult> => callRoute({ ...call, session });

describe('timeout enforcement on every blocked endpoint', () => {
	it.each(blocked)('%s: 403 with the German message', async (_name, build) => {
		const w = await timedOutWorld();
		const { response } = await run(build(w), w.session);
		expect(response.status).toBe(403);
		expect(await response.text()).toBe(BLOCK_MESSAGE);
	});

	it('wrote nothing for any blocked endpoint', async () => {
		const w = await timedOutWorld();
		for (const [, build] of blocked) await run(build(w), w.session);
		expect(await db.select().from(votes)).toHaveLength(0);
		expect(await db.select().from(favorites)).toHaveLength(0);
		expect(await db.select().from(reports)).toHaveLength(0);
		expect(await db.select().from(comments)).toHaveLength(2); // the two fixtures
		const [own] = await db.select().from(media).where(eq(media.id, w.ownMemeId));
		expect(own.nsfw).toBe(false);
	});

	it('the same calls succeed for a user without a timeout (matrix is not failing for other reasons)', async () => {
		const w = await timedOutWorld();
		await db.delete(timeouts);
		for (const [name, build] of blocked) {
			const { response } = await run(build(w), w.session);
			expect(response.status, name).toBeLessThan(300);
		}
	});

	it('an expired or lifted timeout does not block', async () => {
		const w = await timedOutWorld();
		await db
			.update(timeouts)
			.set({ until: new Date(Date.now() - 1000) })
			.where(eq(timeouts.userId, w.victim.id));
		const expired = await run(blocked[1][1](w), w.session);
		expect(expired.response.status).toBe(200);

		await timeOut(w.victim.id, w.victim.id);
		await db.update(timeouts).set({ liftedAt: new Date() }).where(eq(timeouts.userId, w.victim.id));
		const lifted = await run(blocked[1][1](w), w.session);
		expect(lifted.response.status).toBe(200);
	});

	it.each(allowed)('%s stays allowed while timed out', async (_name, build, status) => {
		const w = await timedOutWorld();
		const { response } = await run(build(w), w.session);
		expect(response.status).toBe(status);
	});

	it('markSeen still counts the view while timed out', async () => {
		const w = await timedOutWorld();
		expect(await markSeen(w.victim.id, w.foreignMemeId)).toBe(true);
	});
});

describe('form actions', () => {
	const asSessionUser = (u: { id: number; username: string }): SessionUser => ({
		id: u.id,
		username: u.username,
		role: 'member'
	});

	it('upload action returns the German message under message and error (403)', async () => {
		const w = await timedOutWorld();
		const form = new FormData();
		form.set('title', 'mein Meme');
		form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
		const result = (await uploadActions.default!({
			request: new Request('https://loki.test/upload', { method: 'POST', body: form }),
			locals: { user: asSessionUser(w.victim) }
		} as never)) as { status: number; data: Record<string, unknown> };
		expect(result.status).toBe(403);
		expect(result.data).toMatchObject({
			message: BLOCK_MESSAGE,
			error: BLOCK_MESSAGE,
			title: 'mein Meme'
		});
		expect(await db.select().from(media).where(eq(media.title, 'mein Meme'))).toHaveLength(0);
	});

	it('createMedia refuses a timed-out uploader before touching storage or the database', async () => {
		const w = await timedOutWorld();
		await expect(
			createMedia({
				uploader: asSessionUser(w.victim),
				file: Buffer.from([1, 2, 3]),
				title: 'x',
				tagNames: [],
				nsfw: false,
				spoiler: false
			})
		).rejects.toBeInstanceOf(TimeoutActiveError);
	});

	it('quotes add action returns the German message and keeps the typed values (403)', async () => {
		const w = await timedOutWorld();
		const form = new FormData();
		form.set('text', 'Ein Zitat');
		form.set('author', 'Opa');
		const result = (await quoteActions.add!({
			request: new Request('https://loki.test/quotes?/add', { method: 'POST', body: form }),
			locals: { user: asSessionUser(w.victim) }
		} as never)) as { status: number; data: Record<string, unknown> };
		expect(result.status).toBe(403);
		expect(result.data).toMatchObject({
			message: BLOCK_MESSAGE,
			error: BLOCK_MESSAGE,
			text: 'Ein Zitat',
			author: 'Opa'
		});
		expect(await db.select().from(quotes)).toHaveLength(1); // only the fixture
	});
});
