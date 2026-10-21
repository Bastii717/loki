import type { ContentType, ReportCategory, ReportOutcome } from './server/moderation';

/** German UI texts of the moderation area (client-safe: types only from the server module). */

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
	verletzend: 'Verletzend',
	verstoerend: 'Verstörend',
	falschinfo: 'Falschinfo & Schwurbelei',
	spam: 'Spam',
	sonstiges: 'Sonstiges'
};

export const CONTENT_LABELS: Record<ContentType, string> = {
	meme: 'Meme',
	comment: 'Kommentar',
	quote: 'Zitat'
};

export const OUTCOME_LABELS: Record<ReportOutcome, string> = {
	dismissed: 'Abgewiesen',
	actioned: 'Bestätigt',
	removed: 'Selbst entfernt'
};

export const AUDIT_LABELS: Record<string, string> = {
	report_dismissed: 'Meldungen abgewiesen',
	content_released: 'Inhalt freigegeben',
	content_deleted: 'Inhalt gelöscht',
	flags_forced: 'Blur erzwungen',
	timeout_set: 'Timeout gesetzt',
	timeout_lifted: 'Timeout aufgehoben'
};

export const ROLE_LABELS: Record<string, string> = {
	member: 'Mitglied',
	moderator: 'Moderator',
	admin: 'Admin'
};

const dateTime = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'Europe/Berlin'
});
const dateOnly = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	timeZone: 'Europe/Berlin'
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** "1 Meldung" / "3 Meldungen" */
export const pluralize = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
