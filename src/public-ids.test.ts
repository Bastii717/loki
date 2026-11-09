import { isHttpError } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { awardDueMonths } from './lib/server/awards';
import { addComment } from './lib/server/comments';
import { db } from './lib/server/db';
import { comments, media, templates } from './lib/server/db/schema';
import { resetDb, setupDb } from './lib/server/db/test-utils';
import {
	addOpenReports,
	insertCommentRow,
	insertMemeRow,
	insertQuoteRow,
	OVER_THRESHOLD,
	timeOut,
	userWithSession
} from './lib/server/moderation-test-utils';
import { resetRateLimits } from './lib/server/rate-limit';
import { callRoute } from './lib/server/test-request';
import { load as layoutLoad } from './routes/+layout.server';
import { load as feedLoad } from './routes/+page.server';
import { DELETE as deleteComment } from './routes/api/comments/[pid]/+server';
import { GET as discoverApi } from './routes/api/discover/+server';
import { GET as feedApi } from './routes/api/feed/+server';
import { DELETE as deleteMeme, PATCH as patchMeme } from './routes/api/memes/[pid]/+server';
import {
	GET as getMemeComments,
	POST as postMemeComment
} from './routes/api/memes/[pid]/comments/+server';
import { POST as favoriteMeme } from './routes/api/memes/[pid]/favorite/+server';
import { POST as seenMeme } from './routes/api/memes/[pid]/seen/+server';
import { GET as memeSource } from './routes/api/memes/[pid]/source/+server';
import { POST as voteMeme } from './routes/api/memes/[pid]/vote/+server';
import { DELETE as liftTimeoutApi } from './routes/api/moderation/timeouts/[pid]/+server';
import { POST as profileTool } from './routes/api/moderation/users/[pid]/profile/+server';
import { DELETE as deleteQuote } from './routes/api/quotes/[pid]/+server';
import { POST as voteQuote } from './routes/api/quotes/[pid]/vote/+server';
import { GET as templateImage } from './routes/api/templates/[pid]/image/+server';
import { GET as templateThumb } from './routes/api/templates/[pid]/thumb/+server';
import { load as awardsLoad } from './routes/awards/+page.server';
import { load as createLoad } from './routes/create/+page.server';
import { load as discoverLoad } from './routes/discover/+page.server';
import { load as memeLoad } from './routes/meme/[pid]/+page.server';
import { load as moderationLogLoad } from './routes/moderation/log/+page.server';
import { load as moderationQueueLoad } from './routes/moderation/+page.server';
import { load as moderationResolvedLoad } from './routes/moderation/resolved/+page.server';
import { load as moderationTemplatesLoad } from './routes/moderation/templates/+page.server';
import { load as moderationTimeoutsLoad } from './routes/moderation/timeouts/+page.server';
import { load as moderationUsersLoad } from './routes/moderation/users/+page.server';
import { load as notificationsLoad } from './routes/notifications/+page.server';
import { load as profileLoad } from './routes/profile/+page.server';
import { load as profileFavoritesLoad } from './routes/profile/favorites/+page.server';
import { load as profileMemesLoad } from './routes/profile/memes/+page.server';
import { load as profileStatsLoad } from './routes/profile/stats/+page.server';
import { load as quotesLoad } from './routes/quotes/+page.server';
import { load as searchLoad } from './routes/search/+page.server';
import { load as userLoad } from './routes/users/[pid]/+page.server';

// Every id below is made unmistakable: each table's sequence starts in its own thousand, so a seeded
// internal id (1001, 2001, ...) can never be mistaken for a notification or audit row id (1, 2, ...),
// which are documented to stay numeric.
const SEQUENCE_BASES = {
	media: 1000,
	users: 2000,
	comments: 3000,
	quotes: 4000,
	templates: 5000
} as const;

type Member = Awaited<ReturnType<typeof userWithSession>>;
type World = Awaited<ReturnType<typeof seed>>;

let w: World;

async function seed() {
	await resetDb();
	for (const [table, base] of Object.entries(SEQUENCE_BASES)) {
		await db.execute(sql`SELECT setval(pg_get_serial_sequence(${table}, 'id'), ${base})`);
	}
	const owner = await userWithSession('member');
	const other = await userWithSession('member');
	const admin = await userWithSession('admin');

	const meme = await insertMemeRow(owner.user.id, 'Searchable meme');

	// a comment by the second member: also gives the owner a notice (comment on their meme)
	await addComment(other.user.id, meme.id, 'Searchable comment');
	const [comment] = await db
		.select({ id: comments.id, publicId: comments.publicId })
		.from(comments)
		.where(eq(comments.mediaId, meme.id));
	// a reply by the owner, so comment payloads carry a parentId and a replyToId
	const replyItem = await addComment(owner.user.id, meme.id, 'Searchable reply', comment.id);
	const [reply] = await db
		.select({ id: comments.id, publicId: comments.publicId })
		.from(comments)
		.where(eq(comments.publicId, replyItem.id));

	const quote = await insertQuoteRow(owner.user.id, 'Searchable quote');

	const [template] = await db
		.insert(templates)
		.values({
			name: 'Searchable template',
			objectKey: `templates/utest/${crypto.randomUUID()}.webp`,
			thumbKey: `templates/utest/${crypto.randomUUID()}-t.webp`,
			width: 800,
			height: 600,
			createdBy: admin.user.id
		})
		.returning({ id: templates.id, publicId: templates.publicId });

	// an award: a scored meme from last month (the job awards it and notifies its uploader)
	const now = new Date();
	const [oldMeme] = await db
		.insert(media)
		.values({
			uploaderId: owner.user.id,
			title: 'Last months winner',
			kind: 'image',
			objectKey: `memes/utest/${crypto.randomUUID()}.webp`,
			thumbKey: `memes/utest/${crypto.randomUUID()}-t.webp`,
			score: 5,
			createdAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 3, 12))
		})
		.returning({ id: media.id, publicId: media.publicId });
	await awardDueMonths(now);

	// moderation material: content of the second member that is over the report threshold
	const reportedMeme = await insertMemeRow(other.user.id, 'Reported meme');
	const reportedComment = await insertCommentRow(other.user.id, meme.id, 'Reported comment');
	const reportedQuote = await insertQuoteRow(other.user.id, 'Reported quote');
	const reporters = [
		...(await addOpenReports('meme', reportedMeme.id, other.user.id, OVER_THRESHOLD)),
		...(await addOpenReports('comment', reportedComment.id, other.user.id, OVER_THRESHOLD)),
		...(await addOpenReports('quote', reportedQuote.id, other.user.id, OVER_THRESHOLD))
	];
	await timeOut(other.user.id, admin.user.id);

	const memes = [meme, oldMeme, reportedMeme];
	const commentRows = [comment, reply, reportedComment];
	const quoteRows = [quote, reportedQuote];
	return {
		owner,
		other,
		admin,
		meme,
		oldMeme,
		comment,
		reply,
		quote,
		template,
		internal: {
			media: memes.map((r) => r.id),
			users: [owner.user.id, other.user.id, admin.user.id, ...reporters],
			comments: commentRows.map((r) => r.id),
			quotes: quoteRows.map((r) => r.id),
			templates: [template.id]
		}
	};
}

beforeAll(async () => {
	await setupDb();
	w = await seed();
});
beforeEach(resetRateLimits);

/** Everything a payload may not contain: the routes, query parameters and JSON values of an internal id. */
function leaks(payload: string): string[] {
	const found: string[] = [];
	const all = Object.values(w.internal).flat();
	for (const n of all) {
		// /meme/<n>, /users/<n>, /api/memes/<n>, /api/comments/<n>, /api/quotes/<n>, /api/templates/<n>, ...
		if (new RegExp(`/${n}(?![\\w-])`).test(payload)) found.push(`path segment /${n}`);
		// /create?meme=<n>, ?template=<n>, ?uploader=<n>
		if (new RegExp(`[?&](meme|template|uploader)=${n}(?![\\w-])`).test(payload))
			found.push(`query parameter with ${n}`);
	}
	const key =
		'id|mediaId|uploaderId|authorId|userId|templateId|sourceMemeId|quoteId|commentId|parentId|replyToId|submittedBy|createdBy|actorId|reporterId';
	for (const n of all) {
		// a bare number as the value of an id key; a public id is a string and never matches
		if (new RegExp(`"(?:${key})":${n}(?![\\d.])`).test(payload)) found.push(`"id" key with ${n}`);
	}
	return found;
}

type Load = (event: never) => unknown;

/** Calls a page load directly (callRoute only returns Responses) and serialises what it returns. */
async function runLoad(
	load: Load,
	as: Member,
	path: string,
	params: Record<string, string> = {}
): Promise<string> {
	const url = new URL(`https://loki.test${path}`);
	const event = {
		locals: { user: as.user },
		url,
		params,
		parent: async () => ({ unreadNotifications: 0, openCases: 0 }),
		depends: () => {}
	};
	return JSON.stringify(await load(event as never));
}

/** The status a load answers with: 200 when it returns, the HttpError status when it throws. */
async function loadStatus(
	load: Load,
	as: Member,
	path: string,
	params: Record<string, string> = {}
): Promise<number> {
	try {
		await runLoad(load, as, path, params);
		return 200;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

const json = async (
	handler: Parameters<typeof callRoute>[0]['handler'],
	as: Member,
	path: string,
	extra: { method?: string; params?: Record<string, string>; body?: unknown } = {}
) => {
	const { response } = await callRoute({ handler, path, session: as.session, ...extra });
	return { status: response.status, text: await response.text() };
};

describe('public ids never leak the internal ids', () => {
	it('seeds distinct internal ids and a notice', () => {
		const all = Object.values(w.internal).flat();
		expect(new Set(all).size).toBe(all.length);
		expect(w.meme.id).toBe(SEQUENCE_BASES.media + 1);
		expect(w.owner.user.id).toBe(SEQUENCE_BASES.users + 1);
	});

	// each entry: what is rendered, for whom, and public ids it must carry
	const pages: {
		name: string;
		run: () => Promise<string>;
		expects: () => string[];
	}[] = [
		{
			name: 'root layout',
			run: () => runLoad(layoutLoad as Load, w.owner, '/'),
			expects: () => [w.owner.publicId]
		},
		{
			name: 'feed',
			run: () => runLoad(feedLoad as Load, w.owner, '/'),
			expects: () => [w.meme.publicId, w.owner.publicId]
		},
		{
			name: 'feed (second member)',
			run: () => runLoad(feedLoad as Load, w.other, '/'),
			expects: () => [w.meme.publicId, w.owner.publicId]
		},
		{
			name: 'meme detail (owner)',
			run: () =>
				runLoad(memeLoad as Load, w.owner, `/meme/${w.meme.publicId}`, { pid: w.meme.publicId }),
			expects: () => [
				w.meme.publicId,
				w.comment.publicId,
				`"replyToId":"${w.comment.publicId}"`,
				w.other.publicId,
				w.owner.publicId
			]
		},
		{
			name: 'meme detail (second member)',
			run: () =>
				runLoad(memeLoad as Load, w.other, `/meme/${w.meme.publicId}`, { pid: w.meme.publicId }),
			expects: () => [
				w.meme.publicId,
				w.comment.publicId,
				`"replyToId":"${w.comment.publicId}"`,
				w.other.publicId,
				w.owner.publicId
			]
		},
		{
			name: 'member page (owner)',
			run: () =>
				runLoad(userLoad as Load, w.other, `/users/${w.owner.publicId}`, { pid: w.owner.publicId }),
			expects: () => [w.owner.publicId, w.meme.publicId]
		},
		{
			name: 'member page (own)',
			run: () =>
				runLoad(userLoad as Load, w.owner, `/users/${w.owner.publicId}`, { pid: w.owner.publicId }),
			expects: () => [w.owner.publicId, w.meme.publicId]
		},
		{
			name: 'own memes',
			run: () => runLoad(profileMemesLoad as Load, w.owner, '/profile/memes'),
			expects: () => [w.meme.publicId]
		},
		{
			name: 'profile',
			run: () => runLoad(profileLoad as Load, w.owner, '/profile'),
			expects: () => []
		},
		{
			name: 'profile favorites',
			run: () => runLoad(profileFavoritesLoad as Load, w.owner, '/profile/favorites'),
			expects: () => []
		},
		{
			name: 'profile stats',
			run: () => runLoad(profileStatsLoad as Load, w.owner, '/profile/stats'),
			expects: () => [w.meme.publicId]
		},
		{
			name: 'discover page',
			run: () => runLoad(discoverLoad as Load, w.other, '/discover'),
			expects: () => [w.meme.publicId]
		},
		{
			name: 'search (memes, comments, quotes)',
			run: () => runLoad(searchLoad as Load, w.owner, '/search?q=Searchable'),
			expects: () => [w.meme.publicId, w.comment.publicId, w.quote.publicId]
		},
		{
			name: 'search (people)',
			run: () => runLoad(searchLoad as Load, w.other, '/search?q=@user&type=people'),
			expects: () => [w.owner.publicId]
		},
		{
			name: 'notifications',
			run: () => runLoad(notificationsLoad as Load, w.owner, '/notifications'),
			expects: () => [w.meme.publicId]
		},
		{
			name: 'awards',
			run: () => runLoad(awardsLoad as Load, w.owner, '/awards'),
			expects: () => [w.oldMeme.publicId]
		},
		{
			name: 'quotes',
			run: () => runLoad(quotesLoad as Load, w.owner, '/quotes'),
			expects: () => [w.quote.publicId]
		},
		{
			name: 'create (template grid)',
			run: () => runLoad(createLoad as Load, w.owner, '/create'),
			expects: () => [w.template.publicId]
		},
		{
			name: 'create (template editor)',
			run: () => runLoad(createLoad as Load, w.owner, `/create?template=${w.template.publicId}`),
			expects: () => [w.template.publicId]
		},
		{
			name: 'create (remix editor)',
			run: () => runLoad(createLoad as Load, w.owner, `/create?meme=${w.meme.publicId}`),
			expects: () => [w.meme.publicId]
		},
		{
			name: 'moderation queue',
			run: () => runLoad(moderationQueueLoad as Load, w.admin, '/moderation'),
			expects: () => []
		},
		{
			name: 'moderation resolved',
			run: () => runLoad(moderationResolvedLoad as Load, w.admin, '/moderation/resolved'),
			expects: () => []
		},
		{
			name: 'moderation log',
			run: () => runLoad(moderationLogLoad as Load, w.admin, '/moderation/log'),
			expects: () => []
		},
		{
			name: 'moderation templates',
			run: () => runLoad(moderationTemplatesLoad as Load, w.admin, '/moderation/templates'),
			expects: () => [w.template.publicId]
		},
		{
			name: 'moderation timeouts',
			run: () => runLoad(moderationTimeoutsLoad as Load, w.admin, '/moderation/timeouts'),
			expects: () => [w.other.publicId]
		},
		{
			name: 'moderation users',
			run: () => runLoad(moderationUsersLoad as Load, w.admin, '/moderation/users'),
			expects: () => []
		}
	];

	const apis: {
		name: string;
		run: () => Promise<{ status: number; text: string }>;
		expects: () => string[];
	}[] = [
		{
			name: 'GET /api/feed',
			run: () => json(feedApi, w.owner, '/api/feed'),
			expects: () => [w.meme.publicId, w.owner.publicId]
		},
		{
			name: 'GET /api/feed?list=mine',
			run: () => json(feedApi, w.owner, '/api/feed?list=mine'),
			expects: () => [w.meme.publicId]
		},
		{
			name: 'GET /api/feed?uploader=<pid>',
			run: () => json(feedApi, w.other, `/api/feed?uploader=${w.owner.publicId}`),
			expects: () => [w.meme.publicId, w.owner.publicId]
		},
		{
			name: 'GET /api/memes/<pid>/comments',
			run: () =>
				json(getMemeComments, w.owner, `/api/memes/${w.meme.publicId}/comments`, {
					params: { pid: w.meme.publicId }
				}),
			// the reply carries the comment's public id as parentId and replyToId
			expects: () => [
				w.comment.publicId,
				w.reply.publicId,
				`"parentId":"${w.comment.publicId}"`,
				`"replyToId":"${w.comment.publicId}"`,
				w.other.publicId
			]
		},
		{
			name: 'GET /api/discover',
			run: () => json(discoverApi, w.other, '/api/discover'),
			expects: () => [w.meme.publicId]
		}
	];

	it.each(pages.map((p) => [p.name, p] as const))(
		'%s: page data has no internal id',
		async (_n, p) => {
			const payload = await p.run();
			expect(leaks(payload)).toEqual([]);
			for (const pid of p.expects()) expect(payload).toContain(pid);
		}
	);

	it.each(apis.map((a) => [a.name, a] as const))('%s: JSON has no internal id', async (_n, a) => {
		const { status, text } = await a.run();
		expect(status).toBe(200);
		expect(leaks(text)).toEqual([]);
		for (const pid of a.expects()) expect(text).toContain(pid);
	});

	it('the leak check itself catches an internal id (self test)', () => {
		const n = w.meme.id;
		expect(leaks(`{"id":${n}}`)).not.toEqual([]);
		expect(leaks(`{"mediaId":${n},"x":1}`)).not.toEqual([]);
		const c = w.comment.id;
		expect(leaks(`{"parentId":${c},"replyToId":null}`)).not.toEqual([]);
		expect(leaks(`{"parentId":null,"replyToId":${c}}`)).not.toEqual([]);
		expect(leaks(`href="/meme/${n}"`)).not.toEqual([]);
		expect(leaks(`/create?meme=${n}`)).not.toEqual([]);
		// public ids and the bare notification row ids are fine
		expect(leaks(`{"id":"${w.meme.publicId}","count":1}`)).toEqual([]);
		expect(leaks(`{"id":1,"mediaId":"${w.meme.publicId}"}`)).toEqual([]);
		expect(leaks(`href="/meme/${w.meme.publicId}"`)).toEqual([]);
	});
});

describe('numeric ids answer 404 on every renamed route', () => {
	// the internal ids of the seeded rows, as a path segment would carry them
	const memeN = () => String(w.meme.id);
	const userN = () => String(w.owner.user.id);
	const commentN = () => String(w.comment.id);
	const quoteN = () => String(w.quote.id);
	const templateN = () => String(w.template.id);

	const cases: {
		name: string;
		status: () => Promise<number>;
	}[] = [
		{
			name: 'page /meme/<n>',
			status: () => loadStatus(memeLoad as Load, w.owner, `/meme/${memeN()}`, { pid: memeN() })
		},
		{
			name: 'page /users/<n>',
			status: () => loadStatus(userLoad as Load, w.owner, `/users/${userN()}`, { pid: userN() })
		},
		{
			name: 'page /create?meme=<n>',
			status: () => loadStatus(createLoad as Load, w.owner, `/create?meme=${memeN()}`)
		},
		{
			name: 'page /create?template=<n>',
			status: () => loadStatus(createLoad as Load, w.owner, `/create?template=${templateN()}`)
		},
		...(
			[
				['DELETE /api/memes/<n>', deleteMeme, '', 'DELETE', undefined],
				['PATCH /api/memes/<n>', patchMeme, '', 'PATCH', { nsfw: true }],
				['POST /api/memes/<n>/vote', voteMeme, '/vote', 'POST', { value: 1 }],
				['POST /api/memes/<n>/favorite', favoriteMeme, '/favorite', 'POST', undefined],
				['POST /api/memes/<n>/seen', seenMeme, '/seen', 'POST', undefined],
				['GET /api/memes/<n>/comments', getMemeComments, '/comments', 'GET', undefined],
				['POST /api/memes/<n>/comments', postMemeComment, '/comments', 'POST', { text: 'hello' }],
				['GET /api/memes/<n>/source', memeSource, '/source', 'GET', undefined]
			] as const
		).map(([name, handler, suffix, method, body]) => ({
			name,
			status: async () =>
				(
					await json(handler as never, w.owner, `/api/memes/${memeN()}${suffix}`, {
						method,
						params: { pid: memeN() },
						body
					})
				).status
		})),
		{
			name: 'DELETE /api/comments/<n>',
			status: async () =>
				(
					await json(deleteComment as never, w.admin, `/api/comments/${commentN()}`, {
						method: 'DELETE',
						params: { pid: commentN() }
					})
				).status
		},
		{
			name: 'DELETE /api/quotes/<n>',
			status: async () =>
				(
					await json(deleteQuote as never, w.owner, `/api/quotes/${quoteN()}`, {
						method: 'DELETE',
						params: { pid: quoteN() }
					})
				).status
		},
		{
			name: 'POST /api/quotes/<n>/vote',
			status: async () =>
				(
					await json(voteQuote as never, w.owner, `/api/quotes/${quoteN()}/vote`, {
						method: 'POST',
						params: { pid: quoteN() },
						body: { value: 1 }
					})
				).status
		},
		{
			name: 'GET /api/templates/<n>/image',
			status: async () =>
				(
					await json(templateImage as never, w.owner, `/api/templates/${templateN()}/image`, {
						params: { pid: templateN() }
					})
				).status
		},
		{
			name: 'GET /api/templates/<n>/thumb',
			status: async () =>
				(
					await json(templateThumb as never, w.owner, `/api/templates/${templateN()}/thumb`, {
						params: { pid: templateN() }
					})
				).status
		},
		{
			name: 'POST /api/moderation/users/<n>/profile',
			status: async () =>
				(
					await json(profileTool as never, w.admin, `/api/moderation/users/${userN()}/profile`, {
						method: 'POST',
						params: { pid: userN() },
						body: { action: 'clear-name' }
					})
				).status
		},
		{
			name: 'DELETE /api/moderation/timeouts/<n>',
			status: async () =>
				(
					await json(
						liftTimeoutApi as never,
						w.admin,
						`/api/moderation/timeouts/${String(w.other.user.id)}`,
						{ method: 'DELETE', params: { pid: String(w.other.user.id) } }
					)
				).status
		},
		{
			name: 'GET /api/feed?uploader=<n>',
			status: async () => (await json(feedApi, w.owner, `/api/feed?uploader=${userN()}`)).status
		}
	];

	it.each(cases.map((c) => [c.name, c] as const))('%s answers 404', async (_n, c) => {
		expect(await c.status()).toBe(404);
	});

	it('does not touch anything: the seeded rows are all still there', async () => {
		const [memeRow] = await db.select({ id: media.id }).from(media).where(eq(media.id, w.meme.id));
		expect(memeRow).toBeDefined();
		const [commentRow] = await db
			.select({ id: comments.id })
			.from(comments)
			.where(eq(comments.id, w.comment.id));
		expect(commentRow).toBeDefined();
	});

	it('controls: the same page loads answer 200 for the public id', async () => {
		expect(
			await loadStatus(memeLoad as Load, w.owner, `/meme/${w.meme.publicId}`, {
				pid: w.meme.publicId
			})
		).toBe(200);
		expect(
			await loadStatus(userLoad as Load, w.owner, `/users/${w.owner.publicId}`, {
				pid: w.owner.publicId
			})
		).toBe(200);
		expect(
			await loadStatus(createLoad as Load, w.owner, `/create?template=${w.template.publicId}`)
		).toBe(200);
		expect(await loadStatus(createLoad as Load, w.owner, `/create?meme=${w.meme.publicId}`)).toBe(
			200
		);
	});
});
