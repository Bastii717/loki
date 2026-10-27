import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../server/feed';
import { STATUS_KEY } from '../status-context';
import MemeCard from './MemeCard.svelte';

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
	return {
		id: 1,
		title: 'Montag',
		kind: 'image',
		thumbUrl: '/media/memes/1/thumb.webp',
		mediaUrl: '/media/memes/1/orig.jpg',
		width: 640,
		height: 480,
		tags: ['montag'],
		score: 3,
		userVote: 0,
		commentCount: 0,
		favoriteCount: 0,
		userFavorite: false,
		viewCount: 0,
		blurred: null,
		uploader: 'dev',
		uploaderRole: 'member',
		uploaderAvatar: null,
		mine: false,
		createdAt: new Date().toISOString(),
		underReview: false,
		...overrides
	};
}

const MAINTENANCE = 'Loki is under maintenance. Reading works, posting is paused.';

function withStatus(writable: boolean) {
	return new Map([
		[
			STATUS_KEY,
			{
				value: writable
					? { state: 'ok', message: null, writable: true, nextChangeAt: null }
					: { state: 'maintenance', message: MAINTENANCE, writable: false, nextChangeAt: null }
			}
		]
	]);
}

/** The opening tag of the button carrying `aria-label="label"`. */
function buttonTag(html: string, label: string): string {
	const tag = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
	expect(tag, `${label} button rendered`).not.toBeNull();
	return tag![0];
}

function order(html: string, marker: string): number {
	const at = html.indexOf(marker);
	expect(at, `${marker} rendered`).toBeGreaterThan(-1);
	return at;
}

describe('MemeCard', () => {
	// The reveal button covers the whole media box (`inset: 0`). Positioned siblings stack in DOM
	// order, so the star and the flag must come after it to stay clickable on blurred cards.
	it.each(['nsfw', 'spoiler'] as const)(
		'renders the %s reveal overlay before the favorite star and the report flag',
		(blurred) => {
			const { body } = render(MemeCard, { props: { item: feedItem({ blurred }) } });
			const reveal = order(body, 'class="reveal');
			expect(order(body, 'class="fav')).toBeGreaterThan(reveal);
			expect(order(body, 'class="report overlay')).toBeGreaterThan(reveal);
		}
	);

	it('renders no reveal overlay for unflagged cards', () => {
		const { body } = render(MemeCard, { props: { item: feedItem() } });
		expect(body).not.toContain('class="reveal');
		expect(body).toContain('class="fav');
	});

	it('words the reveal overlay in English', () => {
		const nsfw = render(MemeCard, { props: { item: feedItem({ blurred: 'nsfw' }) } }).body;
		expect(nsfw).toContain('Tap to reveal');
		expect(nsfw).not.toContain('Spoiler');
		const spoiler = render(MemeCard, { props: { item: feedItem({ blurred: 'spoiler' }) } }).body;
		expect(spoiler).toContain('Spoiler — tap to reveal');
	});

	it('labels the favorite button for the current state', () => {
		const off = render(MemeCard, { props: { item: feedItem() } }).body;
		expect(off).toContain('aria-label="Save as favorite"');
		const on = render(MemeCard, { props: { item: feedItem({ userFavorite: true }) } }).body;
		expect(on).toContain('aria-label="Remove favorite"');
	});

	it('words the card chrome in English', () => {
		const { body } = render(MemeCard, { props: { item: feedItem({ title: '' }) } });
		expect(body).toContain('Untitled');
		expect(body).toMatch(/class="by[^"]*">by /);
		expect(body).toMatch(/class="name[^"]*">dev<\/span>/);
		expect(body).toContain('aria-label="Upvote"');
		expect(body).toContain('aria-label="Downvote"');
	});

	describe('uploader', () => {
		it('shows the display name', () => {
			const { body } = render(MemeCard, { props: { item: feedItem({ uploader: 'Hanna Lee' }) } });
			expect(body).toMatch(/class="name[^"]*">Hanna Lee<\/span>/);
		});

		it.each([
			['moderator', 'Moderator'],
			['admin', 'Admin']
		] as const)('badges a %s uploader', (uploaderRole, label) => {
			const { body } = render(MemeCard, { props: { item: feedItem({ uploaderRole }) } });
			expect(body).toContain('role="img"');
			expect(body).toContain(`aria-label="${label}"`);
		});

		it('shows no badge for a member uploader', () => {
			const { body } = render(MemeCard, { props: { item: feedItem() } });
			expect(body).not.toContain('role="img"');
			expect(body).not.toContain('aria-label="Moderator"');
			expect(body).not.toContain('aria-label="Admin"');
		});

		it('shows the avatar image when the uploader has one', () => {
			const { body } = render(MemeCard, {
				props: { item: feedItem({ uploaderAvatar: 'avatars/7/thumb.webp' }) }
			});
			expect(body).toMatch(/<img class="avatar[^"]*" src="\/media\/avatars\/7\/thumb.webp"/);
			expect(body).not.toContain('avatar letter');
		});

		it('falls back to a letter circle without an avatar', () => {
			const { body } = render(MemeCard, { props: { item: feedItem({ uploader: 'dev' }) } });
			expect(body).toContain('avatar letter');
			expect(body).not.toContain('src="/media/avatars');
		});

		it('renders no uploader for hidden items', () => {
			const { body } = render(MemeCard, {
				props: {
					item: feedItem({
						uploader: '',
						uploaderRole: 'member',
						uploaderAvatar: null,
						underReview: true
					})
				}
			});
			expect(body).not.toContain('class="by');
			expect(body).not.toContain('avatar letter');
		});
	});

	describe('while writes are locked', () => {
		it.each(['Upvote', 'Downvote', 'Save as favorite'])(
			'marks the %s button aria-disabled with the reason as title',
			(label) => {
				const { body } = render(MemeCard, {
					props: { item: feedItem() },
					context: withStatus(false)
				});
				const tag = buttonTag(body, label);
				expect(tag).toContain('aria-disabled="true"');
				expect(tag).toContain(`title="${MAINTENANCE}"`);
				expect(tag).not.toMatch(/\sdisabled[\s=>]/);
			}
		);

		it.each([
			['a writable status', withStatus(true)],
			['no status context', undefined]
		])('leaves the controls alone with %s', (_name, context) => {
			const { body } = render(MemeCard, { props: { item: feedItem() }, context });
			for (const label of ['Upvote', 'Downvote', 'Save as favorite']) {
				const tag = buttonTag(body, label);
				expect(tag).not.toContain('aria-disabled');
				expect(tag).not.toContain('title=');
			}
		});
	});
});
