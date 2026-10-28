import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const data = {
	sort: 'new',
	tag: null,
	items: [],
	nextCursor: null,
	season: null,
	user: { id: 1, username: 'lena', displayName: null, role: 'member' },
	avatar: { key: null, thumbKey: null },
	openCases: null
};

const render_ = (extra: Record<string, unknown> = {}) =>
	render(Page as never, { props: { data: { ...data, ...extra } } as never }).body;

describe('feed header', () => {
	it('links a search icon to /search, left of the theme toggle', () => {
		const { body } = render(Page as never, { props: { data } as never });
		const link = body.match(/<a[^>]*href="\/search"[^>]*aria-label="Search"[^>]*>[\s\S]*?<\/a>/);
		expect(link, 'search link rendered').not.toBeNull();
		expect(link![0]).toContain('lucide-search');
		expect(body.indexOf('aria-label="Search"')).toBeLessThan(body.indexOf('theme'));
	});

	it('links the avatar to /profile as the last header action, with no sign-out button', () => {
		const body = render_();
		const link = body.match(/<a[^>]*href="\/profile"[^>]*>[\s\S]*?<\/a>/);
		expect(link, 'profile link rendered').not.toBeNull();
		expect(link![0]).toContain('aria-label="Profile"');
		expect(link![0]).toContain('title="Signed in as lena"');
		// the letter avatar stands in when there is no picture
		expect(link![0]).toMatch(/class="avatar letter[^"]*"[^>]*>\s*L\s*<\/span>/);
		expect(body.indexOf('theme')).toBeLessThan(body.indexOf('href="/profile"'));
		expect(body).not.toContain('action="/logout"');
		expect(body).not.toContain('Sign out');
	});

	it('shows the picture and the display name when the member has them', () => {
		const body = render_({
			user: { ...data.user, displayName: 'Lena K.' },
			avatar: { key: 'avatars/1/a.webp', thumbKey: 'avatars/1/t.webp' }
		});
		expect(body).toContain('title="Signed in as Lena K."');
		expect(body).toContain('src="/media/avatars/1/t.webp"');
	});

	it('carries the open-reports count for moderators, capped at 9+', () => {
		expect(render_()).not.toContain('open reports');
		expect(render_({ openCases: 0 })).not.toContain('open reports');
		const four = render_({ openCases: 4 });
		expect(four).toContain('aria-label="Profile, 4 open reports"');
		expect(four).toMatch(/class="badge[^"]*"[^>]*>4<\/span>/);
		expect(render_({ openCases: 12 })).toMatch(/class="badge[^"]*"[^>]*>9\+<\/span>/);
		expect(render_({ openCases: 1 })).toContain('aria-label="Profile, 1 open report"');
	});

	it('links to the awards page above the list in the Hall of Fame only', () => {
		const html = (sort: string) =>
			render(Page as never, { props: { data: { ...data, sort } } as never }).body;
		const hof = html('hof');
		expect(hof).toMatch(
			/<a href="\/awards" class="awards-link[^"]*">[\s\S]*?lucide-trophy[\s\S]*?Meme of the Month <span aria-hidden="true">→<\/span><\/a>/
		);
		// the sort chip also carries a trophy; the line is the only link to /awards
		expect(html('new')).not.toContain('href="/awards"');
		expect(html('hot')).not.toContain('href="/awards"');
	});
});
