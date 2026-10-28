import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

// MemeCard reads the SvelteKit page state; a bare render has no render context.
vi.mock('$app/state', () => ({ page: { state: {} } }));

const member = (over: Record<string, unknown> = {}) => ({
	id: 7,
	name: 'Hanna Lee',
	username: null,
	role: 'member',
	avatarKey: null,
	avatarThumbKey: null,
	motto: '',
	memberSince: '2026-10-12T10:00:00.000Z',
	...over
});

const feedItem = (id: number) => ({
	id,
	title: `Meme ${id}`,
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
	uploader: 'Hanna Lee',
	uploaderId: 7,
	uploaderRole: 'member',
	uploaderAvatar: null,
	mine: false,
	createdAt: '2026-10-28T10:00:00.000Z',
	underReview: false,
	awardMonth: null
});

const renderPage = (over: Record<string, unknown> = {}, memberOver: Record<string, unknown> = {}) =>
	render(Page as never, {
		props: {
			data: { member: member(memberOver), memeCount: 2, items: [], nextCursor: null, ...over },
			form: null
		} as never
	});

describe('member page', () => {
	it('titles the page with the name', () => {
		expect(renderPage().head).toContain('<title>Hanna Lee · Loki</title>');
	});

	it('shows the name with the role badge, the motto, member since and the memes count', () => {
		const { body } = renderPage(
			{},
			{ role: 'moderator', motto: 'Ship it', avatarThumbKey: 'avatars/u7/x-64.webp' }
		);
		expect(body).toMatch(
			/<h1[^>]*>\s*Hanna Lee\s*<!--[\s\S]*?role="img"[^>]*aria-label="Moderator"/
		);
		expect(body).toContain('Ship it');
		expect(body).toContain('Member since Oct 2026');
		expect(body).toMatch(/<dt[^>]*>Memes<\/dt>\s*<dd[^>]*>2<\/dd>/);
		expect(body).toMatch(/<img class="avatar[^"]*" src="\/media\/avatars\/u7\/x-64\.webp"/);
	});

	it('renders no username line and no motto when they are absent', () => {
		const { body } = renderPage();
		expect(body).not.toContain('class="username');
		expect(body).not.toContain('class="motto');
	});

	it('renders the username line when it is present (moderators)', () => {
		const { body } = renderPage({}, { username: 'hanna.lee' });
		expect(body).toMatch(/class="username[^"]*">hanna\.lee</);
	});

	it('shows the empty state without memes', () => {
		expect(renderPage().body).toContain('No memes yet.');
	});

	it('lists the memes as cards', () => {
		const { body } = renderPage({ items: [feedItem(1), feedItem(2)] });
		expect(body).not.toContain('No memes yet.');
		expect(body).toContain('href="/meme/1"');
		expect(body).toContain('href="/meme/2"');
	});
});
