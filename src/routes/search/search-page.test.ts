import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../lib/server/db';
import { mediaTags, quotes, tags } from '../../lib/server/db/schema';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertComment,
	insertMeme,
	OVER_THRESHOLD,
	userWithSession
} from '../../lib/server/moderation-test-utils';
import { callRoute } from '../../lib/server/test-request';
import { load } from './+page.server';

beforeAll(setupDb);
beforeEach(resetDb);

type Member = Awaited<ReturnType<typeof userWithSession>>;
type Data = Awaited<ReturnType<typeof load>> & {
	q: string;
	text: string;
	scope: string | null;
	type: string;
	page: number;
	tooShort: boolean;
	sections: Record<string, { items?: unknown[]; total?: number } | unknown[] | undefined>;
};

/** The page load for `member`, called directly (callRoute only returns Responses). */
const loadFor = (member: Member, query = '') =>
	load({
		locals: { user: member.user },
		url: new URL(`https://loki.test/search${query}`)
	} as never) as Promise<Data>;

const sectionKeys = (data: Data) => Object.keys(data.sections).sort();

async function tagMeme(mediaId: number, name: string): Promise<void> {
	const [row] = await db
		.insert(tags)
		.values({ name })
		.onConflictDoUpdate({ target: tags.name, set: { name } })
		.returning({ id: tags.id });
	await db.insert(mediaTags).values({ mediaId, tagId: row.id });
}

describe('search page load', () => {
	it('sends an anonymous request to the login page', async () => {
		const res = await callRoute({ handler: load, path: '/search?q=standup' });
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe('/login');
	});

	it('runs nothing without a query', async () => {
		const member = await userWithSession();
		const data = await loadFor(member);
		expect(data).toMatchObject({
			q: '',
			text: '',
			scope: null,
			type: 'all',
			page: 1,
			tooShort: false,
			sections: {}
		});
	});

	it('does not count a blank query as too short', async () => {
		const member = await userWithSession();
		const data = await loadFor(member, '?q=%20%20');
		expect(data.tooShort).toBe(false);
		expect(data.sections).toEqual({});
	});

	it('flags a one-character query as too short and runs nothing', async () => {
		const member = await userWithSession();
		const data = await loadFor(member, '?q=a');
		expect(data).toMatchObject({ q: 'a', text: '', tooShort: true, sections: {} });
	});

	it('flags a bare prefix as too short', async () => {
		const member = await userWithSession();
		expect((await loadFor(member, '?q=%23')).tooShort).toBe(true);
	});

	it('queries every section in the All view, five at a time, with the total', async () => {
		const member = await userWithSession();
		for (let i = 0; i < 7; i++) await insertMeme(member.user.id, `Standup ${i}`);
		const mediaId = await insertMeme(member.user.id, 'Other');
		await insertComment(member.user.id, mediaId, 'the standup was long');
		await db.insert(quotes).values({ text: 'No standup today', author: 'Boss' });
		await tagMeme(mediaId, 'standups');
		const data = await loadFor(member, '?q=standup');
		expect(data).toMatchObject({ q: 'standup', text: 'standup', scope: 'all', type: 'all' });
		expect(sectionKeys(data)).toEqual(['comments', 'memes', 'people', 'quotes', 'tags']);
		// seven by title, one more through its tag
		expect(data.sections.memes).toMatchObject({ total: 8 });
		expect((data.sections.memes as { items: unknown[] }).items).toHaveLength(5);
		expect(data.sections.comments).toMatchObject({ total: 1 });
		expect(data.sections.quotes).toMatchObject({ total: 1 });
		expect(data.sections.people).toMatchObject({ items: [], total: 0 });
		expect(data.sections.tags).toEqual([{ name: 'standups', count: 1 }]);
	});

	it('echoes the raw query and searches the cleaned text', async () => {
		const member = await userWithSession();
		const data = await loadFor(member, '?q=%20%20stand%20%20up%20');
		expect(data).toMatchObject({ q: '  stand  up ', text: 'stand up' });
	});

	it('pages a typed view by 30', async () => {
		const member = await userWithSession();
		for (let i = 0; i < 35; i++) await insertMeme(member.user.id, `Standup ${i}`);
		const first = await loadFor(member, '?q=standup&type=memes');
		expect(sectionKeys(first)).toEqual(['memes']);
		expect(first.type).toBe('memes');
		expect((first.sections.memes as { items: unknown[] }).items).toHaveLength(30);
		const second = await loadFor(member, '?q=standup&type=memes&page=2');
		expect(second.page).toBe(2);
		expect((second.sections.memes as { items: unknown[] }).items).toHaveLength(5);
		expect(second.sections.memes).toMatchObject({ total: 35 });
	});

	it('limits the typed tags view to 30 chips', async () => {
		const member = await userWithSession();
		const mediaId = await insertMeme(member.user.id, 'M');
		for (let i = 0; i < 32; i++) await tagMeme(mediaId, `tag${String(i).padStart(2, '0')}`);
		const data = await loadFor(member, '?q=tag&type=tags');
		expect(sectionKeys(data)).toEqual(['tags']);
		expect(data.sections.tags).toHaveLength(30);
	});

	it.each(['', '?type=bogus', '?type=', '?type=ALL'])(
		'falls back to the All view for an unknown type (%j)',
		async (extra) => {
			const member = await userWithSession();
			const data = await loadFor(member, `?q=standup${extra ? `&${extra.slice(1)}` : ''}`);
			expect(data.type).toBe('all');
			expect(sectionKeys(data)).toHaveLength(5);
		}
	);

	it.each([
		['page=0', 1],
		['page=-3', 1],
		['page=abc', 1],
		['page=2.5', 1],
		['page=99999999999999', 1],
		['page=3', 3]
	])('reads %s as page %i', async (param, expected) => {
		const member = await userWithSession();
		const data = await loadFor(member, `?q=standup&type=memes&${param}`);
		expect(data.page).toBe(expected);
	});

	it('lets a # prefix force the Tags view, whatever ?type= says', async () => {
		const member = await userWithSession();
		const mediaId = await insertMeme(member.user.id, 'Office party');
		await tagMeme(mediaId, 'office');
		const data = await loadFor(member, '?q=%23office&type=memes');
		expect(data).toMatchObject({ scope: 'tags', type: 'tags', text: 'office' });
		expect(sectionKeys(data)).toEqual(['tags']);
		expect(data.sections.tags).toEqual([{ name: 'office', count: 1 }]);
	});

	it('lets an @ prefix force the People view', async () => {
		const lena = await userWithSession();
		const other = await userWithSession();
		await db.execute(sql`UPDATE users SET display_name = 'Lena K' WHERE id = ${lena.user.id}`);
		const data = await loadFor(other, '?q=%40lena&type=quotes');
		expect(data).toMatchObject({ scope: 'people', type: 'people', text: 'lena' });
		expect(sectionKeys(data)).toEqual(['people']);
		expect((data.sections.people as { items: { id: number }[] }).items.map((p) => p.id)).toEqual([
			lena.user.id
		]);
	});

	it('hides a meme under review from members but not from moderators', async () => {
		const member = await userWithSession();
		const moderator = await userWithSession('moderator');
		const id = await insertMeme(member.user.id, 'Standup mishap');
		await addOpenReports('meme', id, member.user.id, OVER_THRESHOLD);
		expect((await loadFor(member, '?q=standup')).sections.memes).toMatchObject({ total: 0 });
		expect((await loadFor(moderator, '?q=standup')).sections.memes).toMatchObject({ total: 1 });
	});
});
