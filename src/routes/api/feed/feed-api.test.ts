import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertMeme,
	OVER_THRESHOLD,
	userWithSession
} from '../../../lib/server/moderation-test-utils';
import { callRoute } from '../../../lib/server/test-request';
import { GET } from './+server';

beforeAll(setupDb);
beforeEach(resetDb);

const feed = (query: string, session?: string) =>
	callRoute({ handler: GET, path: `/api/feed${query}`, session });

interface Page {
	items: { id: number; uploaderId: number | null; underReview: boolean }[];
	nextCursor: string | null;
}

async function world() {
	const [member, mod, author, other] = await Promise.all([
		userWithSession('member'),
		userWithSession('moderator'),
		userWithSession('member'),
		userWithSession('member')
	]);
	const visible = await insertMeme(author.user.id, 'visible');
	const hidden = await insertMeme(author.user.id, 'hidden');
	const foreign = await insertMeme(other.user.id, 'foreign');
	await addOpenReports('meme', hidden, author.user.id, OVER_THRESHOLD);
	return { member, mod, author, other, visible, hidden, foreign };
}

describe('GET /api/feed?uploader=', () => {
	it("lists only that member's memes and drops a hidden one for a member (no placeholder)", async () => {
		const w = await world();
		const res = await feed(`?uploader=${w.author.user.id}`, w.member.session);
		expect(res.response.status).toBe(200);
		const page = (await res.response.json()) as Page;
		expect(page.items.map((i) => i.id)).toEqual([w.visible]);
		expect(page.items[0].uploaderId).toBe(w.author.user.id);
	});

	it('includes the hidden meme, flagged, for a moderator', async () => {
		const w = await world();
		const res = await feed(`?uploader=${w.author.user.id}`, w.mod.session);
		const page = (await res.response.json()) as Page;
		expect(page.items.map((i) => i.id).sort()).toEqual([w.visible, w.hidden].sort());
		expect(page.items.find((i) => i.id === w.hidden)!.underReview).toBe(true);
	});

	it.each(['x', '0', '-3', '1.5', '1e3', '99999999999', ''])(
		'rejects ?uploader=%s with 400',
		async (value) => {
			const w = await world();
			const res = await feed(`?uploader=${value}`, w.member.session);
			expect(res.response.status).toBe(400);
			expect(await res.response.text()).toBe('Invalid uploader');
		}
	);

	it('keeps ?list=mine working', async () => {
		const w = await world();
		const res = await feed('?list=mine', w.other.session);
		const page = (await res.response.json()) as Page;
		expect(page.items.map((i) => i.id)).toEqual([w.foreign]);
	});
});
