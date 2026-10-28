import { describe, expect, it } from 'vitest';
import {
	FILTER_LABELS,
	NOTIFICATION_CATEGORY,
	notificationText,
	type NotificationCategory
} from './notification-labels';
import { NOTIFICATION_KINDS, type NotificationItem } from './server/notifications';

type TextInput = Parameters<typeof notificationText>[0];

const LENA = { name: 'Lena', avatarThumbKey: null };

function item(overrides: Partial<TextInput> & Pick<TextInput, 'kind'>): TextInput {
	return {
		actor: null,
		contentType: null,
		title: null,
		detail: '',
		count: 1,
		...overrides
	};
}

describe('categories', () => {
	it('derives the category from the kind for all twelve kinds', () => {
		const expected: Record<NotificationItem['kind'], NotificationCategory> = {
			comment: 'activity',
			thread_comment: 'activity',
			content_deleted: 'moderation',
			content_flagged: 'moderation',
			content_released: 'moderation',
			report_resolved: 'moderation',
			timeout_set: 'moderation',
			timeout_lifted: 'moderation',
			name_changed: 'moderation',
			name_reset: 'moderation',
			avatar_removed: 'moderation',
			motto_cleared: 'moderation'
		};
		expect(NOTIFICATION_KINDS).toHaveLength(12);
		expect(NOTIFICATION_CATEGORY).toEqual(expected);
	});

	it('labels the filter chips', () => {
		expect(FILTER_LABELS).toEqual({ all: 'All', activity: 'Activity', moderation: 'Moderation' });
	});
});

describe('notificationText', () => {
	it('comment', () => {
		expect(
			notificationText(
				item({ kind: 'comment', actor: LENA, detail: 'Nice one', contentType: 'comment' })
			)
		).toEqual({ text: 'Lena commented on your meme: “Nice one”', excerpt: null });
	});

	it('comment, coalesced', () => {
		expect(
			notificationText(item({ kind: 'comment', actor: LENA, detail: 'Latest', count: 3 }))
		).toEqual({
			text: '3 new comments on your meme, the latest from Lena: “Latest”',
			excerpt: null
		});
	});

	it('comment from a vanished actor', () => {
		expect(notificationText(item({ kind: 'comment', detail: 'Hi' })).text).toBe(
			'Someone commented on your meme: “Hi”'
		);
		expect(notificationText(item({ kind: 'comment', detail: 'Hi', count: 2 })).text).toBe(
			'2 new comments on your meme, the latest from Someone: “Hi”'
		);
	});

	it('thread comment with a title puts the excerpt on its own line', () => {
		expect(
			notificationText(item({ kind: 'thread_comment', actor: LENA, title: 'Cat', detail: 'Same' }))
		).toEqual({ text: 'Lena also commented on “Cat”', excerpt: 'Same' });
	});

	it('thread comment without a title', () => {
		for (const title of [null, '']) {
			expect(
				notificationText(item({ kind: 'thread_comment', actor: LENA, title, detail: 'Same' }))
			).toEqual({ text: 'Lena also commented on a meme you commented on', excerpt: 'Same' });
		}
	});

	it('thread comment from a vanished actor', () => {
		expect(notificationText(item({ kind: 'thread_comment', title: 'Cat' })).text).toBe(
			'Someone also commented on “Cat”'
		);
	});

	it.each([
		['meme', 'A moderator removed your meme: “Excerpt”'],
		['comment', 'A moderator removed your comment: “Excerpt”'],
		['quote', 'A moderator removed your quote: “Excerpt”']
	] as const)('content_deleted (%s)', (contentType, text) => {
		expect(
			notificationText(item({ kind: 'content_deleted', contentType, detail: 'Excerpt' }))
		).toEqual({
			text,
			excerpt: null
		});
	});

	it.each([
		['nsfw', 'A moderator put the NSFW blur on your meme: “Excerpt”'],
		['spoiler', 'A moderator put the spoiler blur on your meme: “Excerpt”'],
		['nsfw,spoiler', 'A moderator put the NSFW and spoiler blur on your meme: “Excerpt”']
	])('content_flagged (%s)', (flags, text) => {
		expect(
			notificationText(
				item({ kind: 'content_flagged', contentType: 'meme', detail: `${flags}:Excerpt` })
			)
		).toEqual({ text, excerpt: null });
	});

	it('content_flagged keeps colons inside the excerpt', () => {
		expect(
			notificationText(item({ kind: 'content_flagged', detail: 'nsfw:Re: this: that' })).text
		).toBe('A moderator put the NSFW blur on your meme: “Re: this: that”');
	});

	it('content_released', () => {
		expect(
			notificationText(item({ kind: 'content_released', contentType: 'meme', detail: 'Excerpt' }))
		).toEqual({ text: 'Your meme was reviewed and is visible again: “Excerpt”', excerpt: null });
		expect(
			notificationText(item({ kind: 'content_released', contentType: 'comment', detail: 'x' })).text
		).toBe('Your comment was reviewed and is visible again: “x”');
	});

	it.each([
		['dismissed', 'Your report on a comment was reviewed: no action taken.'],
		['actioned', 'Your report on a comment was reviewed: action was taken.'],
		['removed', 'Your report on a comment was reviewed: the content was removed.']
	])('report_resolved (%s)', (outcome, text) => {
		expect(
			notificationText(
				item({ kind: 'report_resolved', contentType: 'comment', detail: `${outcome}:Excerpt` })
			)
		).toEqual({ text, excerpt: 'Excerpt' });
	});

	it('report_resolved names the reported content type', () => {
		expect(
			notificationText(
				item({ kind: 'report_resolved', contentType: 'meme', detail: 'dismissed:x' })
			).text
		).toBe('Your report on a meme was reviewed: no action taken.');
		expect(
			notificationText(
				item({ kind: 'report_resolved', contentType: 'quote', detail: 'dismissed:x' })
			).text
		).toBe('Your report on a quote was reviewed: no action taken.');
	});

	it('timeout_set formats the end and keeps colons in the reason', () => {
		expect(
			notificationText(
				item({ kind: 'timeout_set', detail: '2026-11-24T17:30:00.000Z:Cool off: please' })
			)
		).toEqual({ text: 'You are muted until 24 Nov 2026, 18:30: Cool off: please', excerpt: null });
	});

	it.each([
		['timeout_lifted', 'Your timeout was lifted early.'],
		['name_reset', 'An admin reset your display name to your username.'],
		['avatar_removed', 'An admin removed your avatar.'],
		['motto_cleared', 'An admin cleared your motto.']
	] as const)('%s', (kind, text) => {
		expect(notificationText(item({ kind }))).toEqual({ text, excerpt: null });
	});

	it('name_changed', () => {
		expect(notificationText(item({ kind: 'name_changed', detail: 'Ronja' }))).toEqual({
			text: 'An admin renamed you to “Ronja”.',
			excerpt: null
		});
	});
});
