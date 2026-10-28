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
});
