import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TabBar from './TabBar.svelte';

const html = (props: { pathname?: string; badge?: number; unread?: number }) =>
	render(TabBar, { props: { pathname: '/', ...props } }).body;

describe('TabBar', () => {
	it('lists Feed, Discover, the post button, Quotes, Alerts and Profile in order', () => {
		const body = html({});
		const hrefs = [...body.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
		expect(hrefs).toEqual(['/', '/discover', '/upload', '/quotes', '/notifications', '/profile']);
		const labels = [...body.matchAll(/<span class="label">([^<]*)<\/span>/g)].map((m) => m[1]);
		expect(labels).toEqual(['Feed', 'Discover', 'Quotes', 'Alerts', 'Profile']);
	});

	it('shows no badge without unread notices or open reports', () => {
		const body = html({ unread: 0, badge: 0 });
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

	it('keeps the Profile badge for open reports, separate from the bell', () => {
		const body = html({ badge: 4 });
		expect(body).toMatch(/aria-label="4 open reports"[^>]*>4<\/span>/);
		expect(body).not.toContain('unread notifications');
		const both = html({ badge: 12, unread: 2 });
		expect(both).toMatch(/aria-label="12 open reports"[^>]*>9\+<\/span>/);
		expect(both).toMatch(/aria-label="2 unread notifications"[^>]*>2<\/span>/);
		expect(both.indexOf('unread notifications')).toBeLessThan(both.indexOf('open reports'));
	});

	it('marks the Alerts tab as the current page on /notifications', () => {
		const body = html({ pathname: '/notifications' });
		expect(body).toMatch(/href="\/notifications"[^>]*aria-current="page"/);
	});
});
