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
		uploaderRole: 'member',
		uploaderAvatar: null,
		mine: false,
		createdAt: new Date().toISOString(),
		underReview: false,
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
		expect(body).toMatch(/<b[^>]*>Mo Derator<\/b>/);
		expect(body).toMatch(/<img class="avatar[^"]*" src="\/media\/avatars\/u5\/abc-64\.webp"/);
	});
});

describe('MemeDetail uploader line', () => {
	it('shows name, avatar and badge', () => {
		const body = html(feedItem({ uploaderRole: 'admin' }), []);
		expect(body).toMatch(/class="by[^"]*">by /);
		expect(body).toMatch(/class="name[^"]*">Hanna Lee<\/span>/);
		expect(body).toContain('aria-label="Admin"');
	});

	it('renders no uploader group for hidden items', () => {
		const body = html(feedItem({ uploader: '', underReview: true }), []);
		expect(body).not.toContain('class="by');
	});
});
