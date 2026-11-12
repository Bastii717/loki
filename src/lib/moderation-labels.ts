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
	timeout_lifted: 'Timeout lifted',
	maintenance_changed: 'Maintenance changed',
	season_changed: 'Theme changed',
	display_name_changed: 'Display name changed',
	display_name_reset: 'Display name reset',
	avatar_changed: 'Avatar changed',
	avatar_removed: 'Avatar removed',
	motto_changed: 'Motto changed',
	motto_cleared: 'Motto cleared',
	template_added: 'Template added',
	template_renamed: 'Template renamed',
	template_removed: 'Template removed',
	template_restored: 'Template restored',
	sessions_ended: 'Sessions ended'
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
	hourCycle: 'h23',
	timeZone: 'Europe/Berlin'
});
const dateOnly = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'Europe/Berlin'
});

const monthYear = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	year: 'numeric',
	timeZone: 'Europe/Berlin'
});
const monthLong = new Intl.DateTimeFormat('en-US', {
	month: 'long',
	year: 'numeric',
	timeZone: 'Europe/Berlin'
});

/** A `YYYY-MM` month as the 15th at noon UTC, which is that month in Berlin whatever the offset. */
const monthDate = (value: string) =>
	new Date(/^\d{4}-\d{2}$/.test(value) ? `${value}-15T12:00:00Z` : value);

const timeOnly = new Intl.DateTimeFormat('en-GB', {
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: 'Europe/Berlin'
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
/** "Oct 2026" (en-US, so September is "Sep", not "Sept") */
export const formatMonthYear = (value: string) => monthYear.format(monthDate(value));
/** "October 2026" from `YYYY-MM` or an ISO date */
export const formatMonthLong = (value: string) => monthLong.format(monthDate(value));
export const formatTime = (iso: string) => timeOnly.format(new Date(iso));

/** "1 report" / "3 reports" */
export const pluralize = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Display (username)" when a display name exists and differs from the username, else the username. */
export const modName = (display: string | null | undefined, username: string) =>
	display && display !== username ? `${display} (${username})` : username;
