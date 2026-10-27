import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../server/feed';
import DiscoverSlide from './DiscoverSlide.svelte';

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
		commentCount: 0,
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

function html(item: FeedItem): string {
	return render(DiscoverSlide, { props: { item } }).body;
}

describe('DiscoverSlide uploader', () => {
	it('shows the display name', () => {
		expect(html(feedItem())).toMatch(/class="name[^"]*">Hanna Lee<\/span>/);
	});

	it('shows the avatar image when the uploader has one', () => {
		const body = html(feedItem({ uploaderAvatar: 'avatars/u7/abc-64.webp' }));
		expect(body).toMatch(/<img class="avatar[^"]*" src="\/media\/avatars\/u7\/abc-64\.webp"/);
		expect(body).not.toContain('avatar letter');
	});

	it('falls back to a letter circle without an avatar', () => {
		expect(html(feedItem())).toContain('avatar letter');
	});

	it.each([
		['moderator', 'Moderator'],
		['admin', 'Admin']
	] as const)('badges a %s uploader', (uploaderRole, label) => {
		const body = html(feedItem({ uploaderRole }));
		expect(body).toContain('role="img"');
		expect(body).toContain(`aria-label="${label}"`);
	});

	it('shows no badge for a member uploader', () => {
		const body = html(feedItem());
		expect(body).not.toContain('aria-label="Moderator"');
		expect(body).not.toContain('aria-label="Admin"');
	});

	it('renders no uploader for hidden items', () => {
		const body = html(
			feedItem({ uploader: '', uploaderRole: 'member', uploaderAvatar: null, underReview: true })
		);
		expect(body).not.toContain('class="by');
		expect(body).not.toContain('avatar letter');
		expect(body).not.toContain('aria-label="Moderator"');
		expect(body).not.toContain('aria-label="Admin"');
	});
});
