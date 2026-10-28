import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { CommentItem } from '../server/comments';
import type { FeedItem } from '../server/feed';
import MemeDetail from './MemeDetail.svelte';

// `page` reads a SvelteKit render context that a bare component render does not have.
vi.mock('$app/state', () => ({ page: { state: {} } }));

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
	return {
		id: 1,
		title: 'Montag',
		kind: 'image',
		thumbUrl: '/media/memes/1/thumb.webp',
		mediaUrl: '/media/memes/1/orig.jpg',
		width: 640,
		height: 480,
		tags: [],
		score: 3,
		userVote: 0,
		commentCount: 1,
		favoriteCount: 0,
		userFavorite: false,
		viewCount: 0,
		blurred: null,
		uploader: 'Hanna Lee',
		uploaderId: 7,
		uploaderRole: 'member',
		uploaderAvatar: null,
		mine: false,
		createdAt: new Date().toISOString(),
		underReview: false,
		awardMonth: null,
		...overrides
	};
}

function comment(overrides: Partial<CommentItem> = {}): CommentItem {
	return {
		id: 10,
		mediaId: 1,
		authorId: 5,
		author: 'Mo Derator',
		authorRole: 'member',
		authorAvatar: null,
		text: 'Nice one',
		underReview: false,
		createdAt: new Date().toISOString(),
		...overrides
	};
}

function html(item: FeedItem, comments: CommentItem[]): string {
	return render(MemeDetail, {
		props: { item, comments, viewer: { id: 99, canModerate: false }, flags: null }
	}).body;
}

describe('MemeDetail comment authors', () => {
	it('badges a moderator author', () => {
		const body = html(feedItem(), [comment({ authorRole: 'moderator' })]);
		expect(body).toContain('aria-label="Moderator"');
	});

	it('badges an admin author', () => {
		const body = html(feedItem(), [comment({ authorRole: 'admin' })]);
		expect(body).toContain('aria-label="Admin"');
	});

	it('shows no badge for a member author', () => {
		const body = html(feedItem(), [comment()]);
		expect(body).not.toContain('aria-label="Moderator"');
		expect(body).not.toContain('aria-label="Admin"');
	});

	it('shows the author name and an avatar', () => {
		const body = html(feedItem(), [comment({ authorAvatar: 'avatars/u5/abc-64.webp' })]);
		expect(body).toMatch(/<a\b[^>]*href="\/users\/5"[^>]*>Mo Derator<\/a>/);
		expect(body).toMatch(/<img class="avatar[^"]*" src="\/media\/avatars\/u5\/abc-64\.webp"/);
	});
});

describe('MemeDetail uploader line', () => {
	it('shows name, avatar and badge', () => {
		const body = html(feedItem({ uploaderRole: 'admin' }), []);
		expect(body).toMatch(/class="by[^"]*">by /);
		expect(body).toMatch(/class="name[^"]*"[^>]*>Hanna Lee<\/a>/);
		expect(body).toContain('aria-label="Admin"');
	});

	it('renders no uploader group for hidden items', () => {
		const body = html(feedItem({ uploader: '', uploaderId: null, underReview: true }), []);
		expect(body).not.toContain('class="by');
	});
});

describe('MemeDetail name links', () => {
	it('links the uploader name to the member page', () => {
		const body = html(feedItem({ uploaderRole: 'moderator' }), []);
		const link = body.match(/<a\b[^>]*href="\/users\/7"[^>]*>[\s\S]*?<\/a>/);
		expect(link, 'uploader link rendered').not.toBeNull();
		expect(link![0]).toMatch(/class="name[^"]*"/);
		expect(link![0]).toContain('>Hanna Lee</a>');
		expect(link![0]).not.toContain('role="img"');
		expect(body).toContain('aria-label="Moderator"');
	});

	it('renders a plain uploader name when the id is withheld', () => {
		const body = html(feedItem({ uploaderId: null }), []);
		expect(body).toMatch(/<span class="name[^"]*">Hanna Lee<\/span>/);
		expect(body).not.toContain('href="/users/');
	});

	it('links each comment author to /users/<authorId>, badge outside the link', () => {
		const body = html(feedItem(), [
			comment({ id: 1, authorId: 5, author: 'Mo Derator', authorRole: 'moderator' }),
			comment({ id: 2, authorId: 6, author: 'Jonas' })
		]);
		const first = body.match(/<a\b[^>]*href="\/users\/5"[^>]*>[\s\S]*?<\/a>/);
		expect(first![0]).toContain('>Mo Derator</a>');
		expect(first![0]).not.toContain('role="img"');
		expect(body).toMatch(/<a\b[^>]*href="\/users\/6"[^>]*>Jonas<\/a>/);
	});
});

describe('MemeDetail award badge', () => {
	it('shows the badge in the header under the title and uploader line', () => {
		const body = html(feedItem({ awardMonth: '2026-10' }), []);
		expect(body).toContain('Meme of the Month · Oct 2026');
		expect(body).toContain('aria-label="Meme of the Month, October 2026"');
		expect(body.indexOf('Meme of the Month ·')).toBeGreaterThan(body.indexOf('<h1>'));
	});

	it('shows no badge without an award', () => {
		expect(html(feedItem(), [])).not.toContain('Meme of the Month');
	});
});

describe('MemeDetail remix link', () => {
	it('links an image meme to the generator', () => {
		const body = html(feedItem({ id: 42 }), []);
		const link = body.match(/<a\b[^>]*href="\/create\?meme=42"[^>]*>[\s\S]*?<\/a>/);
		expect(link, 'remix link rendered').not.toBeNull();
		expect(link![0]).toContain('Remix');
	});

	it('is absent for a gif and a video', () => {
		expect(html(feedItem({ kind: 'gif' }), [])).not.toContain('/create?meme=');
		expect(html(feedItem({ kind: 'video' }), [])).not.toContain('/create?meme=');
	});

	it('is absent when the meme is withheld from the viewer', () => {
		const body = html(feedItem({ mediaUrl: null, underReview: true }), []);
		expect(body).not.toContain('/create?meme=');
	});
});
