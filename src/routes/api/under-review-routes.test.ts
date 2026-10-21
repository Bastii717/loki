import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../../lib/server/auth/session';
import { db } from '../../lib/server/db';
import { comments, media, quotes } from '../../lib/server/db/schema';
import { resetDb, setupDb, testUser } from '../../lib/server/db/test-utils';
import { addOpenReports, OVER_THRESHOLD } from '../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { callRoute } from '../../lib/server/test-request';
import { load as quotesLoad } from '../quotes/+page.server';
import { load as memeLoad } from '../meme/[id]/+page.server';
import { GET as discover } from './discover/+server';
import { GET as feed } from './feed/+server';
import { GET as getComments } from './memes/[id]/comments/+server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

const TITLE = 'Geheimer Titel';
const COMMENT = 'Geheimer Kommentar';
const QUOTE = 'Geheimes Zitat';

/** An under-review meme, comment and quote, plus a member and a moderator to look at them. */
async function world() {
	const [author, member, mod] = await Promise.all([
		testUser(),
		testUser(),
		testUser({ role: 'moderator' })
	]);
	const [meme] = await db
		.insert(media)
		.values({
			uploaderId: author.id,
			title: TITLE,
			kind: 'image',
			objectKey: 'memes/o.webp',
			thumbKey: 'memes/t.webp'
		})
		.returning({ id: media.id });
	const [comment] = await db
		.insert(comments)
		.values({ mediaId: meme.id, authorId: author.id, text: COMMENT })
		.returning({ id: comments.id });
	const [quote] = await db
		.insert(quotes)
		.values({ submittedBy: author.id, text: QUOTE, author: 'Opa' })
		.returning({ id: quotes.id });
	await addOpenReports('meme', meme.id, author.id, OVER_THRESHOLD);
	await addOpenReports('comment', comment.id, author.id, OVER_THRESHOLD);
	await addOpenReports('quote', quote.id, author.id, OVER_THRESHOLD);
	const user = (u: typeof member, role: 'member' | 'moderator') => ({
		id: u.id,
		username: u.username,
		role
	});
	return {
		memeId: meme.id,
		member: { session: await createSession(member.id), user: user(member, 'member') },
		mod: { session: await createSession(mod.id), user: user(mod, 'moderator') }
	};
}

type Item = { id: number; title: string; mediaUrl: string | null; underReview: boolean };

describe('revealAll plumbing: members get nulled content, moderators the full content', () => {
	it('GET /api/feed', async () => {
		const w = await world();
		const get = async (session: string) => {
			const { response } = await callRoute({ handler: feed, path: '/api/feed', session });
			expect(response.status).toBe(200);
			return ((await response.json()) as { items: Item[] }).items.find((i) => i.id === w.memeId)!;
		};
		expect(await get(w.member.session)).toMatchObject({
			title: '',
			mediaUrl: null,
			underReview: true
		});
		expect(await get(w.mod.session)).toMatchObject({
			title: TITLE,
			mediaUrl: '/media/memes/o.webp',
			underReview: true
		});
	});

	it('GET /api/discover', async () => {
		const w = await world();
		const get = async (session: string) => {
			const { response } = await callRoute({ handler: discover, path: '/api/discover', session });
			expect(response.status).toBe(200);
			return ((await response.json()) as { items: Item[] }).items.find((i) => i.id === w.memeId)!;
		};
		expect(await get(w.member.session)).toMatchObject({ title: '', mediaUrl: null });
		expect(await get(w.mod.session)).toMatchObject({
			title: TITLE,
			mediaUrl: '/media/memes/o.webp'
		});
	});

	it('GET /api/memes/[id]/comments', async () => {
		const w = await world();
		const get = async (session: string) => {
			const { response } = await callRoute({
				handler: getComments,
				path: `/api/memes/${w.memeId}/comments`,
				params: { id: String(w.memeId) },
				session
			});
			expect(response.status).toBe(200);
			return ((await response.json()) as { comments: { text: string | null }[] }).comments;
		};
		expect((await get(w.member.session)).map((c) => c.text)).toEqual([null]);
		expect((await get(w.mod.session)).map((c) => c.text)).toEqual([COMMENT]);
	});

	it('/meme/[id] load', async () => {
		const w = await world();
		const load = (user: (typeof w)['member']['user']) =>
			memeLoad({ params: { id: String(w.memeId) }, locals: { user } } as never) as Promise<{
				item: Item;
				comments: { text: string | null }[];
			}>;
		const asMember = await load(w.member.user);
		expect(asMember.item).toMatchObject({ title: '', mediaUrl: null, underReview: true });
		expect(asMember.comments.map((c) => c.text)).toEqual([null]);

		const asMod = await load(w.mod.user);
		expect(asMod.item).toMatchObject({ title: TITLE, mediaUrl: '/media/memes/o.webp' });
		expect(asMod.comments.map((c) => c.text)).toEqual([COMMENT]);
	});

	it('/quotes load', async () => {
		const w = await world();
		const load = (user: (typeof w)['member']['user']) =>
			quotesLoad({ locals: { user } } as never) as Promise<{
				quotes: { text: string | null; author: string }[];
			}>;
		expect((await load(w.member.user)).quotes).toMatchObject([{ text: null, author: '' }]);
		expect((await load(w.mod.user)).quotes).toMatchObject([{ text: QUOTE, author: 'Opa' }]);
	});
});
