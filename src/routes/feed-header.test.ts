import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const data = {
	sort: 'new',
	tag: null,
	items: [],
	nextCursor: null,
	season: null,
	user: { id: 1, username: 'lena', displayName: null, role: 'member' }
};

describe('feed header', () => {
	it('links a search icon to /search, left of the theme toggle', () => {
		const { body } = render(Page as never, { props: { data } as never });
		const link = body.match(/<a[^>]*href="\/search"[^>]*aria-label="Search"[^>]*>[\s\S]*?<\/a>/);
		expect(link, 'search link rendered').not.toBeNull();
		expect(link![0]).toContain('lucide-search');
		expect(body.indexOf('aria-label="Search"')).toBeLessThan(body.indexOf('theme'));
	});

	it('links to the awards page above the list in the Hall of Fame only', () => {
		const html = (sort: string) =>
			render(Page as never, { props: { data: { ...data, sort } } as never }).body;
		const hof = html('hof');
		expect(hof).toMatch(
			/<a href="\/awards" class="awards-link[^"]*">[\s\S]*?lucide-trophy[\s\S]*?Meme of the Month →<\/a>/
		);
		// the sort chip also carries a trophy; the line is the only link to /awards
		expect(html('new')).not.toContain('href="/awards"');
		expect(html('hot')).not.toContain('href="/awards"');
	});
});
