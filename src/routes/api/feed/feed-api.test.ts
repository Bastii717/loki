import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertMemeRow,
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
	items: { id: string; uploaderId: string | null; underReview: boolean }[];
	nextCursor: string | null;
}

async function world() {
	const [member, mod, author, other] = await Promise.all([
		userWithSession('member'),
		userWithSession('moderator'),
		userWithSession('member'),
		userWithSession('member')
	]);
	const visibleRow = await insertMemeRow(author.user.id, 'visible');
	const hiddenRow = await insertMemeRow(author.user.id, 'hidden');
	const foreignRow = await insertMemeRow(other.user.id, 'foreign');
	await addOpenReports('meme', hiddenRow.id, author.user.id, OVER_THRESHOLD);
	return {
		member,
		mod,
		author,
		other,
		visibleRow,
		visible: visibleRow.publicId,
		hidden: hiddenRow.publicId,
		foreign: foreignRow.publicId
	};
}

describe('GET /api/feed?uploader=', () => {
	it("lists only that member's memes and drops a hidden one for a member (no placeholder)", async () => {
		const w = await world();
		const res = await feed(`?uploader=${w.author.publicId}`, w.member.session);
		expect(res.response.status).toBe(200);
		const page = (await res.response.json()) as Page;
		expect(page.items.map((i) => i.id)).toEqual([w.visible]);
		expect(page.items[0].uploaderId).toBe(w.author.publicId);
		// no internal id anywhere in the payload
		const json = JSON.stringify(page);
		expect(json).not.toMatch(new RegExp(`"id":${w.visibleRow.id}[,}]`));
		expect(json).not.toMatch(new RegExp(`"uploaderId":${w.author.user.id}[,}]`));
	});

	it('includes the hidden meme, flagged, for a moderator', async () => {
		const w = await world();
		const res = await feed(`?uploader=${w.author.publicId}`, w.mod.session);
		const page = (await res.response.json()) as Page;
		expect(page.items.map((i) => i.id).sort()).toEqual([w.visible, w.hidden].sort());
		expect(page.items.find((i) => i.id === w.hidden)!.underReview).toBe(true);
	});

	it.each([
		'x',
		'0',
		'-3',
		'1.5',
		'1e3',
		'99999999999',
		'',
		'AAAAAAAAAAA',
		'AAAAAAAAAAAAA',
		'AAAAAA_AAAAA'
	])('rejects ?uploader=%s with 400', async (value) => {
		const w = await world();
		const res = await feed(`?uploader=${value}`, w.member.session);
		expect(res.response.status).toBe(400);
		expect(await res.response.text()).toBe('Invalid uploader');
	});

	it('rejects the numeric internal id of a real member with 400', async () => {
		const w = await world();
		const res = await feed(`?uploader=${w.author.user.id}`, w.member.session);
		expect(res.response.status).toBe(400);
	});

	it('answers 404 for a well-formed id that belongs to nobody', async () => {
		const w = await world();
		const res = await feed('?uploader=AAAAAAAAAAAA', w.member.session);
		expect(res.response.status).toBe(404);
		expect(await res.response.text()).toBe('Not found');
	});
	it('keeps ?list=mine working', async () => {
		const w = await world();
		const res = await feed('?list=mine', w.other.session);
		const page = (await res.response.json()) as Page;
		expect(page.items.map((i) => i.id)).toEqual([w.foreign]);
	});
});
