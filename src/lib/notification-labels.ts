import { formatDateTime, formatMonthLong } from './moderation-labels';
import type { NotificationItem, NotificationKind } from './server/notifications';

/** English UI texts of the notifications (client-safe: types only from the server module). */

export type NotificationCategory = 'activity' | 'moderation';

export const NOTIFICATION_CATEGORY: Record<NotificationKind, NotificationCategory> = {
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
	motto_cleared: 'moderation',
	award_won: 'activity'
};

export const FILTER_LABELS = { all: 'All', activity: 'Activity', moderation: 'Moderation' };

const FLAG_LABELS: Record<string, string> = {
	nsfw: 'NSFW blur',
	spoiler: 'spoiler blur',
	'nsfw,spoiler': 'NSFW and spoiler blur'
};

const OUTCOME_TEXT: Record<string, string> = {
	dismissed: 'no action taken.',
	actioned: 'action was taken.',
	removed: 'the content was removed.'
};

/** Splits `<head>:<rest>` at the first colon; the rest may contain colons itself. */
function splitHead(detail: string): [string, string] {
	const i = detail.indexOf(':');
	return i === -1 ? [detail, ''] : [detail.slice(0, i), detail.slice(i + 1)];
}

/**
 * The notice copy. `excerpt` is the quoted part shown on its own line (thread comments and report
 * outcomes); the caller adds the quote marks. Everywhere else the excerpt is part of `text`.
 */
export function notificationText(
	item: Pick<NotificationItem, 'kind' | 'actor' | 'contentType' | 'title' | 'detail' | 'count'>
): { text: string; excerpt: string | null } {
	const who = item.actor?.name ?? 'Someone';
	const noun = item.contentType ?? 'meme';
	const { detail } = item;
	switch (item.kind) {
		case 'comment':
			return {
				text:
					item.count > 1
						? `${item.count} new comments on your meme, the latest from ${who}: “${detail}”`
						: `${who} commented on your meme: “${detail}”`,
				excerpt: null
			};
		case 'thread_comment':
			return {
				text: item.title
					? `${who} also commented on “${item.title}”`
					: `${who} also commented on a meme you commented on`,
				excerpt: detail || null
			};
		case 'content_deleted':
			return { text: `A moderator removed your ${noun}: “${detail}”`, excerpt: null };
		case 'content_flagged': {
			const [flags, excerpt] = splitHead(detail);
			const blur = FLAG_LABELS[flags] ?? FLAG_LABELS.nsfw;
			return { text: `A moderator put the ${blur} on your meme: “${excerpt}”`, excerpt: null };
		}
		case 'content_released':
			return {
				text: `Your ${noun} was reviewed and is visible again: “${detail}”`,
				excerpt: null
			};
		case 'report_resolved': {
			const [outcome, excerpt] = splitHead(detail);
			const result = OUTCOME_TEXT[outcome] ?? OUTCOME_TEXT.dismissed;
			return {
				text: `Your report on a ${noun} was reviewed: ${result}`,
				excerpt: excerpt || null
			};
		}
		case 'timeout_set': {
			// `<until ISO>:<reason>`; the ISO string ends in Z, the reason may contain colons
			const match = /^(.+?Z):([\s\S]*)$/.exec(detail);
			const until = match ? formatDateTime(match[1]) : null;
			const reason = match ? match[2] : detail;
			return {
				text: `You are muted${until ? ` until ${until}` : ''}${reason ? `: ${reason}` : '.'}`,
				excerpt: null
			};
		}
		case 'timeout_lifted':
			return { text: 'Your timeout was lifted early.', excerpt: null };
		case 'name_changed':
			return { text: `An admin renamed you to “${detail}”.`, excerpt: null };
		case 'name_reset':
			return { text: 'An admin reset your display name to your username.', excerpt: null };
		case 'avatar_removed':
			return { text: 'An admin removed your avatar.', excerpt: null };
		case 'motto_cleared':
			return { text: 'An admin cleared your motto.', excerpt: null };
		case 'award_won': {
			// `YYYY-MM:<title snapshot>`; the title may contain colons
			const [month, title] = splitHead(detail);
			return {
				text: `Your meme “${title}” is Meme of the Month for ${formatMonthLong(month)}.`,
				excerpt: null
			};
		}
	}
}
