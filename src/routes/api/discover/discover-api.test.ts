import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { insertMemeRow, userWithSession } from '../../../lib/server/moderation-test-utils';
import { callRoute } from '../../../lib/server/test-request';
import { GET } from './+server';

beforeAll(setupDb);
beforeEach(resetDb);

const get = (query: string, session: string) =>
	callRoute({ handler: GET, path: `/api/discover${query}`, session });

describe('GET /api/discover', () => {
	it('serves public ids and skips excluded public ids', async () => {
		const [author, viewer] = await Promise.all([userWithSession(), userWithSession()]);
		const a = await insertMemeRow(author.user.id, 'a');
		const b = await insertMemeRow(author.user.id, 'b');

		const all = await get('', viewer.session);
		const items = ((await all.response.json()) as { items: { id: string }[] }).items;
		expect(items.map((i) => i.id).sort()).toEqual([a.publicId, b.publicId].sort());

		const rest = await get(`?exclude=${a.publicId}`, viewer.session);
		const restItems = ((await rest.response.json()) as { items: { id: string }[] }).items;
		expect(restItems.map((i) => i.id)).toEqual([b.publicId]);
	});

	it('ignores exclude entries that are not public ids (a numeric id excludes nothing)', async () => {
		const [author, viewer] = await Promise.all([userWithSession(), userWithSession()]);
		const a = await insertMemeRow(author.user.id, 'a');
		const res = await get(`?exclude=${a.id},x,AAAAAAAAAAA`, viewer.session);
		expect(res.response.status).toBe(200);
		const items = ((await res.response.json()) as { items: { id: string }[] }).items;
		expect(items.map((i) => i.id)).toEqual([a.publicId]);
	});
});
