import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../lib/server/feed';
import Page from './+page.svelte';

/** A 12-character public id for fixture number `n` of a kind (m: meme, u: user, c: comment). */
const pid = (kind: string, n: number) => `${kind}${String(n).padStart(11, '0')}`;

const feedItem = (id: number, title = `Meme ${id}`): FeedItem => ({
	id: pid('m', id),
	title,
	kind: 'image',
	thumbUrl: `/media/memes/${id}/thumb.webp`,
	mediaUrl: `/media/memes/${id}/orig.jpg`,
	width: 640,
	height: 480,
	tags: [],
	score: 0,
	userVote: 0,
	commentCount: 0,
	favoriteCount: 0,
	userFavorite: false,
	viewCount: 0,
	blurred: null,
	uploader: 'dev',
	uploaderId: pid('u', 7),
	uploaderRole: 'member',
	uploaderAvatar: null,
	mine: false,
	createdAt: '2026-10-28T10:00:00.000Z',
	underReview: false,
	awardMonth: null
});

const memes = (n: number) => Array.from({ length: n }, (_, i) => feedItem(i + 1));

const person = (id: number, name: string, role = 'member') => ({
	id: pid('u', id),
	name,
	username: null,
	role,
	avatarThumbKey: null
});

const comment = (over: Record<string, unknown> = {}) => ({
	id: pid('c', 1),
	mediaId: pid('m', 7),
	mediaTitle: 'Monday cat',
	author: 'Jonas',
	authorId: pid('u', 3),
	authorRole: 'member',
	authorAvatar: null,
	excerpt: 'The weekly standup was long',
	createdAt: '2026-10-28T10:00:00.000Z',
	...over
});

const data = (over: Record<string, unknown> = {}) => ({
	q: '',
	text: '',
	scope: null,
	type: 'all',
	page: 1,
	tooShort: false,
	sections: {},
	...over
});

/** A query that ran: `q`/`text` standup, the given sections. */
const ran = (sections: Record<string, unknown>, over: Record<string, unknown> = {}) =>
	data({ q: 'standup', text: 'standup', scope: 'all', sections, ...over });

const renderPage = (d: Record<string, unknown>) =>
	render(Page as never, { props: { data: d, form: null } as never });
const html = (d: Record<string, unknown>) => renderPage(d).body;

/** The markup without Svelte's scoped class on `<mark>`, so the tests can match on plain tags. */
const marks = (body: string) => body.replace(/<mark class="[^"]*">/g, '<mark>');

/** The `<a>` tags (opening tag up to its closing tag) whose text contains `text`. */
const links = (body: string, text: string) =>
	[...body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]).filter((a) => a.includes(text));

describe('search page', () => {
	it('has the title and heading', () => {
		const out = renderPage(data());
		expect(out.head).toContain('<title>Search · Loki</title>');
		expect(out.body).toMatch(/<h1[^>]*>Search<\/h1>/);
	});

	describe('the form', () => {
		it('is a GET form to /search with the search input and a submit button', () => {
			const body = html(data());
			expect(body).toMatch(/<form[^>]*method="GET"[^>]*action="\/search"/);
			const input = body.match(/<input[^>]*name="q"[^>]*>/);
			expect(input, 'input rendered').not.toBeNull();
			expect(input![0]).toContain('type="search"');
			expect(input![0]).toContain('placeholder="Memes, #tags, @people, comments, quotes"');
			expect(body).toMatch(
				/<button[^>]*type="submit"[^>]*aria-label="Submit search"[^>]*>[\s\S]*?lucide-search/
			);
		});

		it('autofocuses the empty input, but not one that holds a query', () => {
			expect(html(data())).toMatch(/<input[^>]*autofocus/);
			expect(html(ran({}))).not.toMatch(/<input[^>]*autofocus/);
		});

		it('keeps the query in the input', () => {
			expect(html(ran({}, { q: '#office "party"' }))).toContain(
				'value="#office &quot;party&quot;"'
			);
		});
	});

	describe('chips', () => {
		it('are not shown before a query ran', () => {
			expect(html(data())).not.toContain('Search in');
			expect(html(data({ q: 'a', tooShort: true }))).not.toContain('Search in');
		});

		it('link to every view with the text, marking the current one', () => {
			const body = html(ran({}, { type: 'comments' }));
			const nav = body.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
			const hrefs = [...nav.matchAll(/<a href="([^"]*)"([^>]*)>\s*(\w+)\s*<\/a>/g)].map((m) => [
				m[3],
				m[1],
				m[2]
			]);
			expect(hrefs.map(([label]) => label)).toEqual([
				'All',
				'Memes',
				'Tags',
				'People',
				'Comments',
				'Quotes'
			]);
			expect(hrefs[0][1]).toBe('/search?q=standup');
			expect(hrefs[1][1]).toBe('/search?q=standup&amp;type=memes');
			expect(hrefs[2][1]).toBe('/search?q=standup&amp;type=tags');
			expect(hrefs[3][1]).toBe('/search?q=standup&amp;type=people');
			expect(hrefs[4][1]).toBe('/search?q=standup&amp;type=comments');
			expect(hrefs[5][1]).toBe('/search?q=standup&amp;type=quotes');
			expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
			expect(hrefs[4][2]).toContain('aria-current="page"');
		});

		it('carry the text without its # or @ prefix', () => {
			const body = html(
				data({ q: '#office', text: 'office', scope: 'tags', type: 'tags', sections: { tags: [] } })
			);
			expect(body).toContain('href="/search?q=office&amp;type=memes"');
			expect(body).toContain('href="/search?q=office"');
			expect(body).not.toContain('%23');
		});

		it('encode the text', () => {
			const body = html(ran({}, { text: 'a&b c' }));
			expect(body).toContain('href="/search?q=a%26b+c&amp;type=memes"');
		});
	});

	describe('empty states', () => {
		it('invites a search before a query', () => {
			expect(html(data())).toContain('Search memes, tags, people, comments and quotes.');
		});

		it('asks for more characters when the query is too short', () => {
			const body = html(data({ q: 'a', tooShort: true }));
			expect(body).toContain('Type at least 2 characters.');
			expect(body).not.toContain('Nothing found');
		});

		it('says nothing was found when no section has a hit', () => {
			const body = html(
				ran({
					memes: { items: [], total: 0 },
					tags: [],
					people: { items: [], total: 0 },
					comments: { items: [], total: 0 },
					quotes: { items: [], total: 0 }
				})
			);
			expect(body).toContain('Nothing found for “standup”. Try fewer letters or a tag.');
		});

		it('escapes the query in the message', () => {
			const body = html(ran({ memes: { items: [], total: 0 } }, { q: '<b>x</b>' }));
			expect(body).toContain('Nothing found for “&lt;b>x&lt;/b>”');
			expect(body).not.toContain('<b>x</b>');
		});

		it('says nothing was found in a typed view without hits', () => {
			const body = html(ran({ quotes: { items: [], total: 0 } }, { type: 'quotes' }));
			expect(body).toContain('Nothing found for “standup”.');
		});
	});

	describe('the All view', () => {
		it('shows a heading per section that has hits and omits the others', () => {
			const body = html(
				ran({
					memes: { items: memes(2), total: 2 },
					tags: [],
					people: { items: [person(2, 'Lena K')], total: 1 },
					comments: { items: [], total: 0 },
					quotes: { items: [], total: 0 }
				})
			);
			expect(body).toMatch(/<h2[^>]*>Memes<\/h2>/);
			expect(body).toMatch(/<h2[^>]*>People<\/h2>/);
			expect(body).not.toMatch(/<h2[^>]*>Tags<\/h2>/);
			expect(body).not.toMatch(/<h2[^>]*>Comments<\/h2>/);
			expect(body).not.toMatch(/<h2[^>]*>Quotes<\/h2>/);
			expect(body).not.toContain('Nothing found');
		});

		it('links Show all <total> to the typed view when a section has more than five', () => {
			const body = html(
				ran({
					memes: { items: memes(5), total: 12 },
					people: { items: [person(2, 'Lena K')], total: 7 },
					comments: { items: [comment()], total: 5 },
					quotes: { items: [], total: 0 }
				})
			);
			expect(body).toContain('href="/search?q=standup&amp;type=memes"');
			expect(links(body, 'Show all 12')).toHaveLength(1);
			expect(links(body, 'Show all 12')[0]).toContain('href="/search?q=standup&amp;type=memes"');
			expect(links(body, 'Show all 7')[0]).toContain('href="/search?q=standup&amp;type=people"');
			// exactly five is not more than five
			expect(body).not.toContain('Show all 5');
			expect(body).not.toContain('Show more');
		});

		it('reads Show all 500+ when a section hit the count cap', () => {
			const body = html(ran({ memes: { items: memes(5), total: 500 } }));
			expect(links(body, 'Show all 500+')).toHaveLength(1);
			expect(links(body, 'Show all 500+')[0]).toContain('href="/search?q=standup&amp;type=memes"');
		});

		it('still pages a typed view at the cap', () => {
			const body = html(ran({ memes: { items: memes(30), total: 500 } }, { type: 'memes' }));
			expect(links(body, 'Show more')[0]).toContain('page=2');
			expect(body).not.toContain('500+');
			const last = html(
				ran({ memes: { items: memes(20), total: 500 } }, { type: 'memes', page: 17 })
			);
			expect(links(last, 'Show more')).toHaveLength(0);
		});

		it('renders memes as meme cards', () => {
			const body = html(ran({ memes: { items: [feedItem(4, 'Monday cat')], total: 1 } }));
			expect(body).toContain('Monday cat');
			expect(body).toContain(`href="/meme/${pid('m', 4)}"`);
		});
	});

	describe('a typed view', () => {
		it('has no section headings', () => {
			const body = html(
				ran({ people: { items: [person(2, 'Lena K')], total: 1 } }, { type: 'people' })
			);
			expect(body).not.toMatch(/<h2/);
		});

		it('links Show more to the next page when more results are left', () => {
			const body = html(ran({ memes: { items: memes(30), total: 45 } }, { type: 'memes' }));
			const more = links(body, 'Show more');
			expect(more).toHaveLength(1);
			expect(more[0]).toContain('href="/search?q=standup&amp;type=memes&amp;page=2"');
			expect(body).not.toContain('Show all');
		});

		it('has no Show more when the results end exactly on a full page', () => {
			const body = html(ran({ memes: { items: memes(30), total: 30 } }, { type: 'memes' }));
			expect(body).not.toContain('Show more');
			const last = html(
				ran({ memes: { items: memes(30), total: 60 } }, { type: 'memes', page: 2 })
			);
			expect(last).not.toContain('Show more');
		});

		it.each([
			['people', { people: { items: [person(2, 'Lena K')], total: 31 } }],
			['comments', { comments: { items: [comment()], total: 31 } }],
			[
				'quotes',
				{
					quotes: {
						items: [
							{ id: 1, text: 'No standup', author: 'Boss', createdAt: '2026-10-28T10:00:00.000Z' }
						],
						total: 31
					}
				}
			]
		])('decides Show more by the total in the %s view', (type, sections) => {
			const body = html(ran(sections, { type }));
			expect(links(body, 'Show more')[0]).toContain(`type=${type}&amp;page=2`);
		});

		it('counts on from the current page', () => {
			const body = html(
				ran({ memes: { items: memes(30), total: 90 } }, { type: 'memes', page: 2 })
			);
			expect(links(body, 'Show more')[0]).toContain('page=3');
		});

		it('has no Show more on a short page', () => {
			const body = html(ran({ memes: { items: memes(29), total: 29 } }, { type: 'memes' }));
			expect(body).not.toContain('Show more');
		});

		it('never pages the tags', () => {
			const tags = Array.from({ length: 30 }, (_, i) => ({ name: `tag${i}`, count: 1 }));
			const body = html(ran({ tags }, { type: 'tags' }));
			expect(body).not.toContain('Show more');
			expect(body).toContain('#tag29');
		});
	});

	describe('rows', () => {
		it('link tag chips to the tag feed with the count', () => {
			const body = html(ran({ tags: [{ name: 'office', count: 12 }] }));
			const [chip] = links(body, '#office');
			expect(chip).toContain('href="/?tag=office"');
			expect(
				chip
					.replace(/<[^>]*>/g, '')
					.replace(/\s+/g, ' ')
					.trim()
			).toBe('#office 12');
		});

		it('link people to their member page with avatar, name and badge', () => {
			const body = html(
				ran({ people: { items: [person(2, 'Lena K'), person(9, 'Mo', 'moderator')], total: 2 } })
			);
			const [lena] = links(body, 'Lena K');
			expect(lena).toContain(`href="/users/${pid('u', 2)}"`);
			expect(lena).toContain('>L</span>'); // avatar letter
			expect(lena).not.toContain('aria-label="Moderator"');
			const [mo] = links(body, 'Mo');
			expect(mo).toContain(`href="/users/${pid('u', 9)}"`);
			expect(mo).toContain('aria-label="Moderator"');
		});

		it('link a comment to its meme and wrap the match in <mark>', () => {
			const body = marks(html(ran({ comments: { items: [comment()], total: 1 } })));
			const [row] = links(body, 'weekly');
			expect(row).toContain(`href="/meme/${pid('m', 7)}"`);
			expect(row).toContain('The weekly <mark>standup</mark> was long');
			expect(row).toContain('Monday cat');
			expect(row).toMatch(/<time datetime="2026-10-28T10:00:00.000Z">/);
		});

		it('link a comment author to the member page, apart from the link to the meme', () => {
			const body = marks(html(ran({ comments: { items: [comment()], total: 1 } })));
			const [author] = links(body, 'Jonas');
			expect(author).toMatch(new RegExp(`^<a [^>]*href="/users/${pid('u', 3)}"`));
			expect(author.replace(/<[^>]*>/g, '').trim()).toBe('Jonas');
			const [excerpt] = links(body, 'weekly');
			expect(excerpt).toMatch(new RegExp(`^<a [^>]*href="/meme/${pid('m', 7)}"`));
			expect(excerpt).not.toContain('Jonas');
			// the row is a <li> holding both links; an <a> never sits inside another <a>
			const row = body.match(/<li class="[^"]*row[^"]*">[\s\S]*?<\/li>/)![0];
			expect(row.match(/<a\b/g)).toHaveLength(2);
			expect(row).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
		});

		it('shows the role badge of a comment author', () => {
			const body = html(
				ran({ comments: { items: [comment({ authorRole: 'moderator' })], total: 1 } })
			);
			expect(body).toContain('aria-label="Moderator"');
		});

		it('marks the match regardless of case and keeps the excerpt casing', () => {
			const body = marks(
				html(ran({ comments: { items: [comment({ excerpt: 'STANDUP at nine' })], total: 1 } }))
			);
			expect(body).toContain('<mark>STANDUP</mark> at nine');
		});

		it('shows an excerpt without a literal match (a typo hit) unmarked', () => {
			const body = html(
				ran({ comments: { items: [comment({ excerpt: 'the standap was long' })], total: 1 } })
			);
			expect(body).toContain('the standap was long');
			expect(body).not.toContain('<mark>');
		});

		it('escapes HTML in a comment excerpt around the mark', () => {
			const body = marks(
				html(
					ran({
						comments: {
							items: [comment({ excerpt: '<img src=x onerror=alert(1)> standup <b>bold</b>' })],
							total: 1
						}
					})
				)
			);
			expect(body).not.toContain('<img');
			expect(body).not.toContain('<b>bold');
			expect(body).toContain(
				'&lt;img src=x onerror=alert(1)> <mark>standup</mark> &lt;b>bold&lt;/b>'
			);
		});

		it('link a quote to /quotes with the text and its author', () => {
			const body = html(
				ran({
					quotes: {
						items: [
							{
								id: 1,
								text: 'No standup today',
								author: 'Boss',
								createdAt: '2026-10-28T10:00:00.000Z'
							}
						],
						total: 1
					}
				})
			);
			const [row] = links(body, 'No standup today');
			expect(row).toContain('href="/quotes"');
			expect(row).toContain('— Boss');
		});
	});
});
