import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { mediaTags, quotes, tags } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { addOpenReports, insertComment, insertMeme, OVER_THRESHOLD } from './moderation-test-utils';
import {
	escapeLike,
	excerptAround,
	parseQuery,
	searchComments,
	searchMemes,
	searchPeople,
	searchQuotes,
	searchTags,
	SIMILARITY_MIN,
	TOTAL_CAP,
	WORD_SIMILARITY_MIN
} from './search';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const PAGE = { limit: 30, offset: 0 };

async function tagMeme(mediaId: number, name: string): Promise<void> {
	const [row] = await db
		.insert(tags)
		.values({ name })
		.onConflictDoUpdate({ target: tags.name, set: { name } })
		.returning({ id: tags.id });
	await db.insert(mediaTags).values({ mediaId, tagId: row.id });
}

async function insertQuoteRow(text: string, author: string): Promise<number> {
	const [row] = await db.insert(quotes).values({ text, author }).returning({ id: quotes.id });
	return row.id;
}

/** A meme pushed over the report threshold (hidden for members). */
async function hiddenMeme(uploaderId: number, title: string): Promise<number> {
	const id = await insertMeme(uploaderId, title);
	await addOpenReports('meme', id, uploaderId, OVER_THRESHOLD);
	return id;
}

describe('pg_trgm', () => {
	it('uses the similarity threshold SIMILARITY_MIN documents', async () => {
		const shown = await db.transaction(async (tx) => {
			await tx.execute(sql`SELECT similarity('a', 'a')`); // loads the module and its settings
			const [row] = await tx.execute<{ v: string }>(
				sql`SELECT current_setting('pg_trgm.similarity_threshold') AS v`
			);
			return Number(row.v);
		});
		expect(shown).toBe(SIMILARITY_MIN);
	});

	it('scores a one-letter typo above WORD_SIMILARITY_MIN', async () => {
		const [row] = await db.execute<{ s: number }>(
			sql`SELECT word_similarity('metting', 'Weekly meeting notes') AS s`
		);
		expect(row.s).toBeGreaterThanOrEqual(WORD_SIMILARITY_MIN);
		expect(row.s).toBeLessThan(0.6); // the pg_trgm default would miss it
	});
});

describe('parseQuery', () => {
	const cases: [string | null, { scope: string; text: string } | null][] = [
		[null, null],
		['', null],
		['   ', null],
		['  stand  up ', { scope: 'all', text: 'stand up' }],
		['#Office', { scope: 'tags', text: 'Office' }],
		['@le', { scope: 'people', text: 'le' }],
		['# office', { scope: 'tags', text: 'office' }],
		['#', null],
		['@', null],
		['#a', null],
		['a', null],
		['ab', { scope: 'all', text: 'ab' }]
	];
	it.each(cases)('parses %j', (raw, expected) => {
		expect(parseQuery(raw)).toEqual(expected);
	});

	it('cuts the text at 80 characters', () => {
		expect(parseQuery('x'.repeat(81))).toEqual({ scope: 'all', text: 'x'.repeat(80) });
	});

	it('removes only one leading marker', () => {
		expect(parseQuery('##tag')).toEqual({ scope: 'tags', text: '#tag' });
	});
});

describe('escapeLike', () => {
	it('escapes the LIKE wildcards and the backslash', () => {
		expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
	});
	it('leaves other text alone', () => {
		expect(escapeLike('stand up')).toBe('stand up');
	});
});

describe('excerptAround', () => {
	const long = `${'a '.repeat(150)}NEEDLE${' b'.repeat(150)}`;

	it('returns short text unchanged', () => {
		expect(excerptAround('hello world', 'world')).toBe('hello world');
	});

	it('centres the match and marks both cut ends', () => {
		const out = excerptAround(long, 'needle', 160);
		expect(out.startsWith('…')).toBe(true);
		expect(out.endsWith('…')).toBe(true);
		expect(out).toContain('NEEDLE');
		const inner = out.slice(1, -1);
		expect(inner.length).toBeLessThanOrEqual(160);
		const middle = inner.indexOf('NEEDLE') + 3;
		expect(Math.abs(middle - inner.length / 2)).toBeLessThan(6);
	});

	it('marks only the end when the match is at the start', () => {
		const out = excerptAround(`needle ${'x'.repeat(400)}`, 'needle', 160);
		expect(out.startsWith('needle')).toBe(true);
		expect(out.endsWith('…')).toBe(true);
	});

	it('marks only the start when the match is at the end', () => {
		const out = excerptAround(`${'x'.repeat(400)} needle`, 'needle', 160);
		expect(out.startsWith('…')).toBe(true);
		expect(out.endsWith('needle')).toBe(true);
	});

	it('takes the first width characters when the needle is absent', () => {
		expect(excerptAround('abcdefghij'.repeat(30), 'zzz', 20)).toBe(`${'abcdefghij'.repeat(2)}…`);
	});

	it('collapses whitespace', () => {
		expect(excerptAround('a\n\n  b\tneedle   c', 'needle')).toBe('a b needle c');
	});
});

describe('searchMemes', () => {
	it('finds a title by substring', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Monday standup');
		await insertMeme(u.id, 'Something else');
		const { items, total } = await searchMemes(u.id, false, 'standu', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
		expect(total).toBe(1);
	});

	it('finds a typo inside a longer title', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Weekly meeting notes');
		await insertMeme(u.id, 'Cat on a keyboard');
		const { items } = await searchMemes(u.id, false, 'metting', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
	});

	it('is case-insensitive', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Monday STANDUP');
		const { items } = await searchMemes(u.id, false, 'standup', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
	});

	it('brings a meme in through a matching tag', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Unrelated title');
		await tagMeme(id, 'office');
		await insertMeme(u.id, 'Another one');
		const { items, total } = await searchMemes(u.id, false, 'offic', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
		expect(items[0].tags).toEqual(['office']);
		expect(total).toBe(1);
	});

	it('lists a meme once when title and several tags match', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Office party');
		await tagMeme(id, 'office');
		await tagMeme(id, 'office-fun');
		const { items, total } = await searchMemes(u.id, false, 'office', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
		expect(total).toBe(1);
	});

	it('does not match on the uploader name', async () => {
		const u = await testUser({ displayName: 'Zebrafinch' });
		await insertMeme(u.id, 'Plain');
		const { items } = await searchMemes(u.id, false, 'zebrafinch', PAGE);
		expect(items).toEqual([]);
	});

	it('ranks an exact title above a partial one', async () => {
		const u = await testUser();
		// the partial one is newer, so only the similarity can put the exact one first
		const exact = await insertMeme(u.id, 'standup');
		const partial = await insertMeme(u.id, 'standups');
		const { items } = await searchMemes(u.id, false, 'standup', PAGE);
		expect(items.map((i) => i.id)).toEqual([exact, partial]);
	});

	it('orders equal matches newest first', async () => {
		const u = await testUser();
		const first = await insertMeme(u.id, 'standup');
		const second = await insertMeme(u.id, 'standup');
		const { items } = await searchMemes(u.id, false, 'standup', PAGE);
		expect(items.map((i) => i.id)).toEqual([second, first]);
	});

	it('matches % literally', async () => {
		const u = await testUser();
		const hit = await insertMeme(u.id, 'a%c');
		await insertMeme(u.id, 'abc');
		await insertMeme(u.id, 'axxc');
		const { items } = await searchMemes(u.id, false, 'a%c', PAGE);
		expect(items.map((i) => i.id)).toEqual([hit]);
	});

	it('matches _ literally', async () => {
		const u = await testUser();
		const hit = await insertMeme(u.id, 'a_c');
		await insertMeme(u.id, 'abc');
		const { items } = await searchMemes(u.id, false, 'a_c', PAGE);
		expect(items.map((i) => i.id)).toEqual([hit]);
	});

	it('hides a meme under review from members, in items and in total', async () => {
		const u = await testUser();
		const visible = await insertMeme(u.id, 'Standup visible');
		const hidden = await hiddenMeme(u.id, 'Standup hidden');
		const member = await searchMemes(u.id, false, 'standup', PAGE);
		expect(member.items.map((i) => i.id)).toEqual([visible]);
		expect(member.total).toBe(1);
		const mod = await searchMemes(u.id, true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id).sort()).toEqual([visible, hidden].sort());
		expect(mod.total).toBe(2);
		expect(mod.items.find((i) => i.id === hidden)?.underReview).toBe(true);
	});

	it('does not reveal a hidden meme through its tag', async () => {
		const u = await testUser();
		const hidden = await hiddenMeme(u.id, 'Secret');
		await tagMeme(hidden, 'secrettag');
		const member = await searchMemes(u.id, false, 'secrettag', PAGE);
		expect(member).toEqual({ items: [], total: 0 });
		const mod = await searchMemes(u.id, true, 'secrettag', PAGE);
		expect(mod.items.map((i) => i.id)).toEqual([hidden]);
	});

	it('pages with limit and offset in ranked order', async () => {
		const u = await testUser();
		const ids: number[] = [];
		for (let i = 0; i < 5; i++) ids.push(await insertMeme(u.id, 'standup'));
		const newestFirst = [...ids].reverse();
		const p1 = await searchMemes(u.id, false, 'standup', { limit: 2, offset: 0 });
		const p2 = await searchMemes(u.id, false, 'standup', { limit: 2, offset: 2 });
		const p3 = await searchMemes(u.id, false, 'standup', { limit: 2, offset: 4 });
		expect(p1.items.map((i) => i.id)).toEqual(newestFirst.slice(0, 2));
		expect(p2.items.map((i) => i.id)).toEqual(newestFirst.slice(2, 4));
		expect(p3.items.map((i) => i.id)).toEqual(newestFirst.slice(4));
		expect(p1.total).toBe(5);
		expect(p3.total).toBe(5);
	});

	it('returns nothing for no match', async () => {
		const u = await testUser();
		await insertMeme(u.id, 'Something');
		expect(await searchMemes(u.id, false, 'qqqqqq', PAGE)).toEqual({ items: [], total: 0 });
	});
});

describe('searchTags', () => {
	it('finds tags by substring with the count of visible memes', async () => {
		const u = await testUser();
		const a = await insertMeme(u.id, 'A');
		const b = await insertMeme(u.id, 'B');
		await tagMeme(a, 'office');
		await tagMeme(b, 'office');
		await tagMeme(a, 'cats');
		expect(await searchTags(false, 'offic', 10)).toEqual([{ name: 'office', count: 2 }]);
	});

	it('finds a near miss by similarity', async () => {
		const u = await testUser();
		await tagMeme(await insertMeme(u.id, 'A'), 'monday');
		const names = (await searchTags(false, 'mondey', 10)).map((t) => t.name);
		expect(names).toEqual(['monday']);
	});

	it('ranks by similarity, then name', async () => {
		const u = await testUser();
		const m = await insertMeme(u.id, 'A');
		await tagMeme(m, 'catsup');
		await tagMeme(m, 'cats');
		await tagMeme(m, 'cat');
		const names = (await searchTags(false, 'cat', 10)).map((t) => t.name);
		expect(names).toEqual(['cat', 'cats', 'catsup']);
	});

	it('does not count memes under review for members, but does for moderators', async () => {
		const u = await testUser();
		const shown = await insertMeme(u.id, 'Shown');
		const hidden = await hiddenMeme(u.id, 'Hidden');
		await tagMeme(shown, 'office');
		await tagMeme(hidden, 'office');
		await tagMeme(hidden, 'onlyhidden');
		expect(await searchTags(false, 'office', 10)).toEqual([{ name: 'office', count: 1 }]);
		expect(await searchTags(true, 'office', 10)).toEqual([{ name: 'office', count: 2 }]);
		// a tag carried only by a hidden meme is still listed, with count 0
		expect(await searchTags(false, 'onlyhidden', 10)).toEqual([{ name: 'onlyhidden', count: 0 }]);
		expect(await searchTags(true, 'onlyhidden', 10)).toEqual([{ name: 'onlyhidden', count: 1 }]);
	});

	it('matches % and _ literally', async () => {
		const u = await testUser();
		const m = await insertMeme(u.id, 'A');
		await tagMeme(m, 'a%c');
		await tagMeme(m, 'x_y');
		await tagMeme(m, 'abc');
		await tagMeme(m, 'xzy');
		expect((await searchTags(false, 'a%c', 10)).map((t) => t.name)).toEqual(['a%c']);
		expect((await searchTags(false, 'x_y', 10)).map((t) => t.name)).toEqual(['x_y']);
		expect(await searchTags(false, '%%', 10)).toEqual([]);
	});

	it('honors the limit', async () => {
		const u = await testUser();
		const m = await insertMeme(u.id, 'A');
		for (const name of ['tag1', 'tag2', 'tag3']) await tagMeme(m, name);
		expect(await searchTags(false, 'tag', 2)).toHaveLength(2);
	});
});

describe('searchPeople', () => {
	it('finds a member by display name and falls back to the username', async () => {
		const a = await testUser({ displayName: 'Lena Fischer', username: 'lfischer' });
		const b = await testUser({ username: 'lenny' });
		const { items, total } = await searchPeople(false, 'len', PAGE);
		expect(total).toBe(2);
		expect(items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
		expect(items.find((i) => i.id === a.id)?.name).toBe('Lena Fischer');
		expect(items.find((i) => i.id === b.id)?.name).toBe('lenny');
	});

	it('does not match a username that a display name hides, for members', async () => {
		await testUser({ displayName: 'Lena', username: 'secret.login' });
		expect(await searchPeople(false, 'secret', PAGE)).toEqual({ items: [], total: 0 });
	});

	it('lets moderators match the username, and fills it only for them', async () => {
		const u = await testUser({ displayName: 'Lena', username: 'secret.login', role: 'moderator' });
		const mod = await searchPeople(true, 'secret', PAGE);
		expect(mod.total).toBe(1);
		expect(mod.items).toEqual([
			{
				id: u.id,
				name: 'Lena',
				username: 'secret.login',
				role: 'moderator',
				avatarThumbKey: null
			}
		]);
		const byName = await searchPeople(false, 'lena', PAGE);
		expect(byName.items).toHaveLength(1);
		expect(byName.items[0].username).toBeNull();
		expect(byName.items[0].role).toBe('moderator');
	});

	it('returns the avatar thumb key', async () => {
		await testUser({ displayName: 'Pic', avatarThumbKey: 'avatars/x-t.webp' });
		const { items } = await searchPeople(false, 'pic', PAGE);
		expect(items[0].avatarThumbKey).toBe('avatars/x-t.webp');
	});

	it('ranks the closer name first', async () => {
		await testUser({ displayName: 'Jonathan' });
		const near = await testUser({ displayName: 'Jonas' });
		const { items } = await searchPeople(false, 'jonas', PAGE);
		expect(items[0].id).toBe(near.id);
	});

	it('matches % and _ literally', async () => {
		const hit = await testUser({ displayName: 'a%c' });
		await testUser({ displayName: 'abc' });
		const under = await testUser({ displayName: 'x_y' });
		await testUser({ displayName: 'xzy' });
		expect((await searchPeople(false, 'a%c', PAGE)).items.map((i) => i.id)).toEqual([hit.id]);
		expect((await searchPeople(false, 'x_y', PAGE)).items.map((i) => i.id)).toEqual([under.id]);
		expect(await searchPeople(false, '%%', PAGE)).toEqual({ items: [], total: 0 });
	});

	it('pages', async () => {
		for (const n of ['Anna', 'Annabel', 'Annika']) await testUser({ displayName: n });
		const p1 = await searchPeople(false, 'ann', { limit: 2, offset: 0 });
		const p2 = await searchPeople(false, 'ann', { limit: 2, offset: 2 });
		expect(p1.total).toBe(3);
		expect(p1.items).toHaveLength(2);
		expect(p2.items).toHaveLength(1);
		expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(3);
	});
});

describe('searchComments', () => {
	it('finds a comment by substring with excerpt, meme title and author', async () => {
		const author = await testUser({ displayName: 'Lena', role: 'moderator' });
		const meme = await insertMeme(author.id, 'The meme');
		const id = await insertComment(author.id, meme, 'Honestly the best standup ever');
		await insertComment(author.id, meme, 'Unrelated');
		const { items, total } = await searchComments(false, 'standu', PAGE);
		expect(total).toBe(1);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id,
			mediaId: meme,
			mediaTitle: 'The meme',
			author: 'Lena',
			authorId: author.id,
			authorRole: 'moderator',
			authorAvatar: null,
			excerpt: 'Honestly the best standup ever'
		});
		expect(Number.isNaN(Date.parse(items[0].createdAt))).toBe(false);
	});

	it('cuts a long comment around the match', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		await insertComment(u.id, meme, `${'blah '.repeat(80)}needle${' blah'.repeat(80)}`);
		const { items } = await searchComments(false, 'needle', PAGE);
		expect(items[0].excerpt.startsWith('…')).toBe(true);
		expect(items[0].excerpt.endsWith('…')).toBe(true);
		expect(items[0].excerpt).toContain('needle');
	});

	it('finds a typo inside a longer comment', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		const id = await insertComment(u.id, meme, 'We should have a weekly meeting about this');
		const { items } = await searchComments(false, 'metting', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
	});

	it('hides a comment under review from members, in items and in total', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		const shown = await insertComment(u.id, meme, 'standup shown');
		const hidden = await insertComment(u.id, meme, 'standup hidden');
		await addOpenReports('comment', hidden, u.id, OVER_THRESHOLD);
		const member = await searchComments(false, 'standup', PAGE);
		expect(member.items.map((i) => i.id)).toEqual([shown]);
		expect(member.total).toBe(1);
		const mod = await searchComments(true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id).sort()).toEqual([shown, hidden].sort());
		expect(mod.total).toBe(2);
	});

	it('hides a comment on a meme under review from members (the hit would reveal the title)', async () => {
		const u = await testUser();
		const meme = await hiddenMeme(u.id, 'Secret title');
		const id = await insertComment(u.id, meme, 'standup on the hidden one');
		expect(await searchComments(false, 'standup', PAGE)).toEqual({ items: [], total: 0 });
		const mod = await searchComments(true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id)).toEqual([id]);
		expect(mod.items[0].mediaTitle).toBe('Secret title');
		expect(mod.total).toBe(1);
	});

	it('matches % literally', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		const hit = await insertComment(u.id, meme, 'a%c');
		await insertComment(u.id, meme, 'abc');
		await insertComment(u.id, meme, 'axxc');
		const { items } = await searchComments(false, 'a%c', PAGE);
		expect(items.map((i) => i.id)).toEqual([hit]);
	});

	it('orders equal matches newest first and pages', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		const ids: number[] = [];
		for (let i = 0; i < 3; i++) ids.push(await insertComment(u.id, meme, 'standup'));
		const p1 = await searchComments(false, 'standup', { limit: 2, offset: 0 });
		const p2 = await searchComments(false, 'standup', { limit: 2, offset: 2 });
		expect(p1.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
		expect(p2.items.map((i) => i.id)).toEqual([ids[0]]);
		expect(p1.total).toBe(3);
	});
});

describe('searchQuotes', () => {
	it('finds a quote by its text', async () => {
		const id = await insertQuoteRow('Never trust a standup that ends on time', 'Opa');
		await insertQuoteRow('Something else entirely', 'Oma');
		const { items, total } = await searchQuotes(false, 'standu', PAGE);
		expect(total).toBe(1);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id,
			text: 'Never trust a standup that ends on time',
			author: 'Opa'
		});
		expect(Number.isNaN(Date.parse(items[0].createdAt))).toBe(false);
	});

	it('finds a quote by its author', async () => {
		const id = await insertQuoteRow('Wise words', 'Grandpa Joe');
		await insertQuoteRow('Other words', 'Somebody');
		const { items } = await searchQuotes(false, 'grandpa', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
	});

	it('finds a typo inside a longer quote', async () => {
		const id = await insertQuoteRow('We should have a weekly meeting about this', 'Opa');
		const { items } = await searchQuotes(false, 'metting', PAGE);
		expect(items.map((i) => i.id)).toEqual([id]);
	});

	it('hides a quote under review from members, in items and in total', async () => {
		const u = await testUser();
		const shown = await insertQuoteRow('standup shown', 'Opa');
		const hidden = await insertQuoteRow('standup hidden', 'Opa');
		await addOpenReports('quote', hidden, u.id, OVER_THRESHOLD);
		const member = await searchQuotes(false, 'standup', PAGE);
		expect(member.items.map((i) => i.id)).toEqual([shown]);
		expect(member.total).toBe(1);
		const mod = await searchQuotes(true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id).sort()).toEqual([shown, hidden].sort());
		expect(mod.total).toBe(2);
	});

	it('matches % literally', async () => {
		const hit = await insertQuoteRow('a%c', 'Opa');
		await insertQuoteRow('abc', 'Opa');
		await insertQuoteRow('axxc', 'Opa');
		const { items } = await searchQuotes(false, 'a%c', PAGE);
		expect(items.map((i) => i.id)).toEqual([hit]);
	});

	it('pages with limit and offset', async () => {
		const ids: number[] = [];
		for (let i = 0; i < 3; i++) ids.push(await insertQuoteRow('standup', 'Opa'));
		const p1 = await searchQuotes(false, 'standup', { limit: 2, offset: 0 });
		const p2 = await searchQuotes(false, 'standup', { limit: 2, offset: 2 });
		expect(p1.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
		expect(p2.items.map((i) => i.id)).toEqual([ids[0]]);
	});

	it('caps total at 500', async () => {
		await db
			.insert(quotes)
			.values(Array.from({ length: 501 }, () => ({ text: 'zzz', author: 'Opa' })));
		const { items, total } = await searchQuotes(false, 'zzz', { limit: 5, offset: 0 });
		expect(TOTAL_CAP).toBe(500);
		expect(total).toBe(500);
		expect(items).toHaveLength(5);
	});
});
