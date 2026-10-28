import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TabBar from './TabBar.svelte';

const html = (props: { pathname?: string; unread?: number }) =>
	render(TabBar, { props: { pathname: '/', ...props } }).body;

describe('TabBar', () => {
	// The profile moved to the feed header: two tabs on each side keep the post button centred.
	it('lists Feed and Discover, the post button, then Quotes and Alerts', () => {
		const body = html({});
		const hrefs = [...body.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
		expect(hrefs).toEqual(['/', '/discover', '/upload', '/quotes', '/notifications']);
		const labels = [...body.matchAll(/<span class="label">([^<]*)<\/span>/g)].map((m) => m[1]);
		expect(labels).toEqual(['Feed', 'Discover', 'Quotes', 'Alerts']);
		expect(body).not.toContain('/profile');
	});

	it('shows no badge without unread notices', () => {
		const body = html({ unread: 0 });
		expect(body).not.toContain('class="badge');
		expect(body).not.toContain('role="img"');
	});

	it('shows the unread count on the bell', () => {
		const body = html({ unread: 3 });
		expect(body).toMatch(/aria-label="3 unread notifications"[^>]*>3<\/span>/);
	});

	it('caps the unread count at 9+', () => {
		const body = html({ unread: 12 });
		expect(body).toMatch(/aria-label="12 unread notifications"[^>]*>9\+<\/span>/);
	});

	it('marks the Alerts tab as the current page on /notifications', () => {
		const body = html({ pathname: '/notifications' });
		expect(body).toMatch(/href="\/notifications"[^>]*aria-current="page"/);
	});
});
