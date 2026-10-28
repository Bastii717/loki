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
		uploaderId: 7,
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
		expect(html(feedItem())).toMatch(/class="name[^"]*"[^>]*>Hanna Lee<\/a>/);
	});

	it('links the name to the member page', () => {
		const link = html(feedItem()).match(/<a\b[^>]*href="\/users\/7"[^>]*>[\s\S]*?<\/a>/);
		expect(link, 'name link rendered').not.toBeNull();
		expect(link![0]).toMatch(/class="name[^"]*"/);
		expect(link![0]).toContain('>Hanna Lee</a>');
		expect(link![0]).not.toContain('avatar');
	});

	it('renders a plain name when the uploader id is withheld', () => {
		const body = html(feedItem({ uploaderId: null }));
		expect(body).toMatch(/<span class="name[^"]*">Hanna Lee<\/span>/);
		expect(body).not.toContain('/users/');
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
			feedItem({
				uploader: '',
				uploaderId: null,
				uploaderRole: 'member',
				uploaderAvatar: null,
				underReview: true
			})
		);
		expect(body).not.toContain('class="by');
		expect(body).not.toContain('avatar letter');
		expect(body).not.toContain('aria-label="Moderator"');
		expect(body).not.toContain('aria-label="Admin"');
	});
});
