import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { mediaTags, quotes, tags } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import {
	addOpenReports,
	insertCommentRow,
	insertMemeRow,
	OVER_THRESHOLD
} from './moderation-test-utils';
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

// Rows are addressed by internal id inside the tests; results carry public ids. Each insert helper
// remembers the public id of what it created, `memePub(id)` and friends translate back.
const publicIds = new Map<string, string>();
const remember = (kind: string, row: { id: number; publicId: string }) => {
	publicIds.set(`${kind}:${row.id}`, row.publicId);
	return row.id;
};
const lookup = (kind: string, id: number) => publicIds.get(`${kind}:${id}`)!;
const memePub = (id: number) => lookup('meme', id);
const memePubs = (ids: number[]) => ids.map(memePub);
const commentPub = (id: number) => lookup('comment', id);
const commentPubs = (ids: number[]) => ids.map(commentPub);
const quotePub = (id: number) => lookup('quote', id);
const quotePubs = (ids: number[]) => ids.map(quotePub);

async function insertMeme(uploaderId: number, title: string): Promise<number> {
	return remember('meme', await insertMemeRow(uploaderId, title));
}

async function insertComment(authorId: number, mediaId: number, text: string): Promise<number> {
	return remember('comment', await insertCommentRow(authorId, mediaId, text));
}

async function insertQuoteRow(text: string, author: string): Promise<number> {
	const [row] = await db
		.insert(quotes)
		.values({ text, author })
		.returning({ id: quotes.id, publicId: quotes.publicId });
	return remember('quote', row);
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

	describe('with a stricter default configured on every connection', () => {
		/** Sets the session default of the similarity threshold on each pooled connection. */
		const setDefault = (value: string) =>
			Promise.all(
				Array.from({ length: 10 }, () =>
					db.execute(
						sql`SELECT set_config('pg_trgm.similarity_threshold', ${value}, false), pg_sleep(0.2)`
					)
				)
			);
		beforeEach(() => setDefault('0.95'));
		afterEach(() => setDefault(String(SIMILARITY_MIN)));

		it('still finds a near-miss tag', async () => {
			const u = await testUser();
			await tagMeme(await insertMeme(u.id, 'A'), 'monday');
			expect((await searchTags(false, 'mondey', 10)).map((t) => t.name)).toEqual(['monday']);
		});

		it('still finds a near-miss person', async () => {
			const u = await testUser({ displayName: 'Jonathan' });
			expect((await searchPeople(false, 'Jonathon', PAGE)).items.map((p) => p.id)).toEqual([
				u.publicId
			]);
		});
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

	it('strips control characters, NUL included', () => {
		expect(parseQuery('ab\u0000c')).toEqual({ scope: 'all', text: 'abc' });
		expect(parseQuery('\u0007ab\u007fc\u001f')).toEqual({ scope: 'all', text: 'abc' });
		expect(parseQuery('\u0000')).toBeNull();
	});

	it('still collapses tabs and newlines into one space', () => {
		expect(parseQuery('a\t\nb')).toEqual({ scope: 'all', text: 'a b' });
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
		expect(items.map((i) => i.id)).toEqual(memePubs([id]));
		expect(total).toBe(1);
	});

	it('finds a typo inside a longer title', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Weekly meeting notes');
		await insertMeme(u.id, 'Cat on a keyboard');
		const { items } = await searchMemes(u.id, false, 'metting', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([id]));
	});

	it('is case-insensitive', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Monday STANDUP');
		const { items } = await searchMemes(u.id, false, 'standup', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([id]));
	});

	it('brings a meme in through a matching tag', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Unrelated title');
		await tagMeme(id, 'office');
		await insertMeme(u.id, 'Another one');
		const { items, total } = await searchMemes(u.id, false, 'offic', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([id]));
		expect(items[0].tags).toEqual(['office']);
		expect(total).toBe(1);
	});

	it('lists a meme once when title and several tags match', async () => {
		const u = await testUser();
		const id = await insertMeme(u.id, 'Office party');
		await tagMeme(id, 'office');
		await tagMeme(id, 'office-fun');
		const { items, total } = await searchMemes(u.id, false, 'office', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([id]));
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
		expect(items.map((i) => i.id)).toEqual(memePubs([exact, partial]));
	});

	it('orders equal matches newest first', async () => {
		const u = await testUser();
		const first = await insertMeme(u.id, 'standup');
		const second = await insertMeme(u.id, 'standup');
		const { items } = await searchMemes(u.id, false, 'standup', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([second, first]));
	});

	it('matches % literally', async () => {
		const u = await testUser();
		const hit = await insertMeme(u.id, 'a%c');
		await insertMeme(u.id, 'abc');
		await insertMeme(u.id, 'axxc');
		const { items } = await searchMemes(u.id, false, 'a%c', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([hit]));
	});

	it('matches _ literally', async () => {
		const u = await testUser();
		const hit = await insertMeme(u.id, 'a_c');
		await insertMeme(u.id, 'abc');
		const { items } = await searchMemes(u.id, false, 'a_c', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([hit]));
	});

	it('hides a meme under review from members, in items and in total', async () => {
		const u = await testUser();
		const visible = await insertMeme(u.id, 'Standup visible');
		const hidden = await hiddenMeme(u.id, 'Standup hidden');
		const member = await searchMemes(u.id, false, 'standup', PAGE);
		expect(member.items.map((i) => i.id)).toEqual(memePubs([visible]));
		expect(member.total).toBe(1);
		const mod = await searchMemes(u.id, true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id).sort()).toEqual(memePubs([visible, hidden]).sort());
		expect(mod.total).toBe(2);
		expect(mod.items.find((i) => i.id === memePub(hidden))?.underReview).toBe(true);
	});

	it('never returns an item under review to a member, whichever of two matches is hidden', async () => {
		const u = await testUser();
		const stays = await insertMeme(u.id, 'Standup one');
		await hiddenMeme(u.id, 'Standup two');
		const { items, total } = await searchMemes(u.id, false, 'standup', PAGE);
		expect(items.map((i) => i.id)).toEqual(memePubs([stays]));
		expect(items.every((i) => !i.underReview)).toBe(true);
		expect(total).toBe(1);
	});

	it('does not reveal a hidden meme through its tag', async () => {
		const u = await testUser();
		const hidden = await hiddenMeme(u.id, 'Secret');
		await tagMeme(hidden, 'secrettag');
		const member = await searchMemes(u.id, false, 'secrettag', PAGE);
		expect(member).toEqual({ items: [], total: 0 });
		const mod = await searchMemes(u.id, true, 'secrettag', PAGE);
		expect(mod.items.map((i) => i.id)).toEqual(memePubs([hidden]));
	});

	it('pages with limit and offset in ranked order', async () => {
		const u = await testUser();
		const ids: number[] = [];
		for (let i = 0; i < 5; i++) ids.push(await insertMeme(u.id, 'standup'));
		const newestFirst = [...ids].reverse();
		const p1 = await searchMemes(u.id, false, 'standup', { limit: 2, offset: 0 });
		const p2 = await searchMemes(u.id, false, 'standup', { limit: 2, offset: 2 });
		const p3 = await searchMemes(u.id, false, 'standup', { limit: 2, offset: 4 });
		expect(p1.items.map((i) => i.id)).toEqual(memePubs(newestFirst.slice(0, 2)));
		expect(p2.items.map((i) => i.id)).toEqual(memePubs(newestFirst.slice(2, 4)));
		expect(p3.items.map((i) => i.id)).toEqual(memePubs(newestFirst.slice(4)));
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
		expect(await searchTags(true, 'onlyhidden', 10)).toEqual([{ name: 'onlyhidden', count: 1 }]);
	});

	it('leaves out a tag with no visible meme for members, but lists it for moderators', async () => {
		const u = await testUser();
		const hidden = await hiddenMeme(u.id, 'Hidden');
		await tagMeme(hidden, 'onlyhidden');
		await tagMeme(await insertMeme(u.id, 'Shown'), 'onlyshown');
		await db.insert(tags).values({ name: 'unused' }); // a tag no meme carries
		expect(await searchTags(false, 'only', 10)).toEqual([{ name: 'onlyshown', count: 1 }]);
		expect(await searchTags(false, 'unused', 10)).toEqual([]);
		expect(await searchTags(true, 'onlyhidden', 10)).toEqual([{ name: 'onlyhidden', count: 1 }]);
		expect(await searchTags(true, 'unused', 10)).toEqual([{ name: 'unused', count: 0 }]);
	});

	it('keeps its own limit when hidden tags are filtered out', async () => {
		const u = await testUser();
		const hidden = await hiddenMeme(u.id, 'Hidden');
		const shown = await insertMeme(u.id, 'Shown');
		// 'tag0' sorts first but is hidden; the limit must still yield two visible tags
		await tagMeme(hidden, 'tag0');
		await tagMeme(shown, 'tag1');
		await tagMeme(shown, 'tag2');
		expect((await searchTags(false, 'tag', 2)).map((t) => t.name)).toEqual(['tag1', 'tag2']);
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
		expect(items.map((i) => i.id).sort()).toEqual([a.publicId, b.publicId].sort());
		expect(items.find((i) => i.id === a.publicId)?.name).toBe('Lena Fischer');
		expect(items.find((i) => i.id === b.publicId)?.name).toBe('lenny');
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
				id: u.publicId,
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
		expect(items[0].id).toBe(near.publicId);
	});

	it('matches % and _ literally', async () => {
		const hit = await testUser({ displayName: 'a%c' });
		await testUser({ displayName: 'abc' });
		const under = await testUser({ displayName: 'x_y' });
		await testUser({ displayName: 'xzy' });
		expect((await searchPeople(false, 'a%c', PAGE)).items.map((i) => i.id)).toEqual([hit.publicId]);
		expect((await searchPeople(false, 'x_y', PAGE)).items.map((i) => i.id)).toEqual([
			under.publicId
		]);
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
	it('finds a comment by the current name of a mentioned member', async () => {
		const author = await testUser();
		const mentioned = await testUser({ displayName: 'Zebulon' });
		const meme = await insertMeme(author.id, 'M');
		const id = await insertComment(author.id, meme, `hey @[u:${mentioned.publicId}] look`);
		const { items } = await searchComments(false, 'Zebulon', PAGE);
		expect(items.map((i) => i.id)).toEqual([commentPub(id)]);
		expect(items[0].excerpt).toBe('hey @Zebulon look');
	});

	it('finds comments with and without mention tokens side by side', async () => {
		const author = await testUser();
		const mentioned = await testUser({ displayName: 'Quentin' });
		const meme = await insertMeme(author.id, 'M');
		const plain = await insertComment(author.id, meme, 'plain banana talk');
		const tokened = await insertComment(author.id, meme, `@[u:${mentioned.publicId}] banana too`);
		const { items, total } = await searchComments(false, 'banana', PAGE);
		expect(total).toBe(2);
		expect(new Set(items.map((i) => i.id))).toEqual(
			new Set([commentPub(plain), commentPub(tokened)])
		);
		expect(items.find((i) => i.id === commentPub(plain))?.excerpt).toBe('plain banana talk');
		// a token comment matches on its rendered text only, never on the raw public id
		expect((await searchComments(false, mentioned.publicId, PAGE)).total).toBe(0);
	});

	it('mention_text follows display name changes', async () => {
		const author = await testUser();
		const mentioned = await testUser({ displayName: 'Oldname' });
		const meme = await insertMeme(author.id, 'M');
		const id = await insertComment(author.id, meme, `hi @[u:${mentioned.publicId}] there`);
		await db.execute(sql`UPDATE users SET display_name = 'Newname' WHERE id = ${mentioned.id}`);
		expect((await searchComments(false, 'Oldname', PAGE)).items).toEqual([]);
		const { items } = await searchComments(false, 'Newname', PAGE);
		expect(items.map((i) => i.id)).toEqual([commentPub(id)]);
		expect(items[0].excerpt).toBe('hi @Newname there');
		expect(items[0].excerpt).not.toContain('@[u:');
	});

	it('never lists a tombstone', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		const id = await insertComment(u.id, meme, 'findable words');
		await db.execute(sql`UPDATE comments SET deleted_at = now(), text = '' WHERE id = ${id}`);
		const { items, total } = await searchComments(false, 'findable', PAGE);
		expect(items).toEqual([]);
		expect(total).toBe(0);
		await db.execute(sql`UPDATE comments SET text = 'findable words' WHERE id = ${id}`);
		expect((await searchComments(true, 'findable', PAGE)).total).toBe(0);
	});

	it('finds a comment by substring with excerpt, meme title and author', async () => {
		const author = await testUser({ displayName: 'Lena', role: 'moderator' });
		const meme = await insertMeme(author.id, 'The meme');
		const id = await insertComment(author.id, meme, 'Honestly the best standup ever');
		await insertComment(author.id, meme, 'Unrelated');
		const { items, total } = await searchComments(false, 'standu', PAGE);
		expect(total).toBe(1);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: commentPub(id),
			mediaId: memePub(meme),
			mediaTitle: 'The meme',
			author: 'Lena',
			authorId: author.publicId,
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
		expect(items.map((i) => i.id)).toEqual(commentPubs([id]));
	});

	it('hides a comment under review from members, in items and in total', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		const shown = await insertComment(u.id, meme, 'standup shown');
		const hidden = await insertComment(u.id, meme, 'standup hidden');
		await addOpenReports('comment', hidden, u.id, OVER_THRESHOLD);
		const member = await searchComments(false, 'standup', PAGE);
		expect(member.items.map((i) => i.id)).toEqual(commentPubs([shown]));
		expect(member.total).toBe(1);
		const mod = await searchComments(true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id).sort()).toEqual(commentPubs([shown, hidden]).sort());
		expect(mod.total).toBe(2);
	});

	it('hides a comment on a meme under review from members (the hit would reveal the title)', async () => {
		const u = await testUser();
		const meme = await hiddenMeme(u.id, 'Secret title');
		const id = await insertComment(u.id, meme, 'standup on the hidden one');
		expect(await searchComments(false, 'standup', PAGE)).toEqual({ items: [], total: 0 });
		const mod = await searchComments(true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id)).toEqual(commentPubs([id]));
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
		expect(items.map((i) => i.id)).toEqual(commentPubs([hit]));
	});

	it('orders equal matches newest first and pages', async () => {
		const u = await testUser();
		const meme = await insertMeme(u.id, 'M');
		const ids: number[] = [];
		for (let i = 0; i < 3; i++) ids.push(await insertComment(u.id, meme, 'standup'));
		const p1 = await searchComments(false, 'standup', { limit: 2, offset: 0 });
		const p2 = await searchComments(false, 'standup', { limit: 2, offset: 2 });
		expect(p1.items.map((i) => i.id)).toEqual(commentPubs([ids[2], ids[1]]));
		expect(p2.items.map((i) => i.id)).toEqual(commentPubs([ids[0]]));
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
			id: quotePub(id),
			text: 'Never trust a standup that ends on time',
			author: 'Opa'
		});
		expect(Number.isNaN(Date.parse(items[0].createdAt))).toBe(false);
	});

	it('finds a quote by its author', async () => {
		const id = await insertQuoteRow('Wise words', 'Grandpa Joe');
		await insertQuoteRow('Other words', 'Somebody');
		const { items } = await searchQuotes(false, 'grandpa', PAGE);
		expect(items.map((i) => i.id)).toEqual(quotePubs([id]));
	});

	it('finds a typo inside a longer quote', async () => {
		const id = await insertQuoteRow('We should have a weekly meeting about this', 'Opa');
		const { items } = await searchQuotes(false, 'metting', PAGE);
		expect(items.map((i) => i.id)).toEqual(quotePubs([id]));
	});

	it('hides a quote under review from members, in items and in total', async () => {
		const u = await testUser();
		const shown = await insertQuoteRow('standup shown', 'Opa');
		const hidden = await insertQuoteRow('standup hidden', 'Opa');
		await addOpenReports('quote', hidden, u.id, OVER_THRESHOLD);
		const member = await searchQuotes(false, 'standup', PAGE);
		expect(member.items.map((i) => i.id)).toEqual(quotePubs([shown]));
		expect(member.total).toBe(1);
		const mod = await searchQuotes(true, 'standup', PAGE);
		expect(mod.items.map((i) => i.id).sort()).toEqual(quotePubs([shown, hidden]).sort());
		expect(mod.total).toBe(2);
	});

	it('matches % literally', async () => {
		const hit = await insertQuoteRow('a%c', 'Opa');
		await insertQuoteRow('abc', 'Opa');
		await insertQuoteRow('axxc', 'Opa');
		const { items } = await searchQuotes(false, 'a%c', PAGE);
		expect(items.map((i) => i.id)).toEqual(quotePubs([hit]));
	});

	it('pages with limit and offset', async () => {
		const ids: number[] = [];
		for (let i = 0; i < 3; i++) ids.push(await insertQuoteRow('standup', 'Opa'));
		const p1 = await searchQuotes(false, 'standup', { limit: 2, offset: 0 });
		const p2 = await searchQuotes(false, 'standup', { limit: 2, offset: 2 });
		expect(p1.items.map((i) => i.id)).toEqual(quotePubs([ids[2], ids[1]]));
		expect(p2.items.map((i) => i.id)).toEqual(quotePubs([ids[0]]));
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
