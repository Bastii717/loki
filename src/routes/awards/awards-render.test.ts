import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '../../lib/server/feed';
import Page from './+page.svelte';

// MemeCard reads the SvelteKit page state; a bare render has no render context.
vi.mock('$app/state', () => ({ page: { state: {} } }));

const feedItem = (id: number, over: Partial<FeedItem> = {}): FeedItem => ({
	id,
	title: `Meme ${id}`,
	kind: 'image',
	thumbUrl: `/media/memes/${id}/thumb.webp`,
	mediaUrl: `/media/memes/${id}/orig.jpg`,
	width: 640,
	height: 480,
	tags: [],
	score: 5,
	userVote: 0,
	commentCount: 0,
	favoriteCount: 0,
	userFavorite: false,
	viewCount: 0,
	blurred: null,
	uploader: 'dev',
	uploaderId: 7,
	uploaderRole: 'member',
	uploaderAvatar: null,
	mine: false,
	createdAt: '2026-10-28T10:00:00.000Z',
	underReview: false,
	awardMonth: null,
	...over
});

const renderPage = (over: Record<string, unknown> = {}) =>
	render(Page as never, {
		props: {
			data: {
				leading: null,
				sections: [],
				hasMore: false,
				nextBefore: null,
				firstClose: '2026-10-31T23:00:00.000Z',
				...over
			}
		} as never
	});

describe('awards page', () => {
	it('titles the page and the heading', () => {
		const { head, body } = renderPage();
		expect(head).toContain('<title>Meme of the Month · Loki</title>');
		expect(body).toMatch(/<h1[^>]*>Meme of the Month<\/h1>/);
	});

	it('renders one section per month with an id, a long month heading and the card', () => {
		const { body } = renderPage({
			sections: [
				{ month: '2026-10', item: feedItem(3, { awardMonth: '2026-10' }) },
				{ month: '2026-09', item: feedItem(2, { awardMonth: '2026-09' }) }
			]
		});
		expect(body).toMatch(/<section[^>]*id="2026-10"[^>]*>\s*<h2[^>]*>October 2026<\/h2>/);
		expect(body).toMatch(/<section[^>]*id="2026-09"[^>]*>\s*<h2[^>]*>September 2026<\/h2>/);
		expect(body).toContain('href="/meme/3"');
		expect(body).toContain('href="/meme/2"');
		expect(body.indexOf('id="2026-10"')).toBeLessThan(body.indexOf('id="2026-09"'));
		expect(body).not.toContain('No winners yet');
	});

	it('shows the deleted note for a deleted winner and never a title', () => {
		const { body } = renderPage({
			// a stray title in the data must not reach the page either
			sections: [{ month: '2026-09', item: null, title: 'Gone meme' }]
		});
		expect(body).toMatch(/<p class="deleted[^"]*">The winning meme was deleted\.<\/p>/);
		expect(body).not.toContain('Gone meme');
		expect(body).not.toContain('href="/meme/');
	});

	it('shows the leader block with its note, pluralised', () => {
		const lead = (score: number) =>
			renderPage({ leading: { month: '2026-10', item: feedItem(9), score } }).body;
		const many = lead(4);
		expect(many).toMatch(/<h2[^>]*>Leading right now<\/h2>/);
		expect(many).toContain('href="/meme/9"');
		expect(many).toContain('Leads October 2026 with 4 points');
		expect(lead(1)).toContain('Leads October 2026 with 1 point<');
		expect(renderPage().body).not.toContain('Leading right now');
	});

	it('shows the empty state with the first close date', () => {
		const { body } = renderPage();
		expect(body).toContain('No winners yet. The first month closes on');
		expect(body).toContain('1 Nov 2026');
	});

	it('keeps the empty sentence under a lone leader block', () => {
		const { body } = renderPage({
			leading: { month: '2026-10', item: feedItem(9), score: 2 }
		});
		expect(body).toContain('Leading right now');
		expect(body).toContain('No winners yet.');
	});

	it('links Show older only when more winners remain', () => {
		const sections = [{ month: '2026-09', item: feedItem(2) }];
		const more = renderPage({ sections, hasMore: true, nextBefore: '2026-09' }).body;
		expect(more).toMatch(/<a[^>]*href="\/awards\?before=2026-09"[^>]*>\s*Show older/);
		expect(renderPage({ sections }).body).not.toContain('Show older');
	});
});
