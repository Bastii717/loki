import type { ContentType, ReportCategory, ReportOutcome } from './server/moderation';

/** English UI texts of the moderation area (client-safe: types only from the server module). */

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
	hurtful: 'Hurtful',
	disturbing: 'Disturbing',
	misinformation: 'Misinformation & nonsense',
	spam: 'Spam',
	other: 'Other'
};

export const CONTENT_LABELS: Record<ContentType, string> = {
	meme: 'Meme',
	comment: 'Comment',
	quote: 'Quote'
};

export const OUTCOME_LABELS: Record<ReportOutcome, string> = {
	dismissed: 'Dismissed',
	actioned: 'Confirmed',
	removed: 'Removed by owner'
};

export const AUDIT_LABELS: Record<string, string> = {
	report_dismissed: 'Reports dismissed',
	content_released: 'Content released',
	content_deleted: 'Content deleted',
	flags_forced: 'Blur forced',
	flags_changed: 'Flags changed',
	site_content_changed: 'Rules/FAQ changed',
	timeout_set: 'Timeout set',
	timeout_lifted: 'Timeout lifted'
};

export const ROLE_LABELS: Record<string, string> = {
	member: 'Member',
	moderator: 'Moderator',
	admin: 'Admin'
};

const dateTime = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false,
	timeZone: 'Europe/Berlin'
});
const dateOnly = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'Europe/Berlin'
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** "1 report" / "3 reports" */
export const pluralize = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
