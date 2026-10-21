import { error, fail } from '@sveltejs/kit';
import { ReportError, TimeoutActionError, TimeoutActiveError } from './moderation';

const dateFormat = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	timeZone: 'Europe/Berlin'
});

/** German user-facing text for a blocked write, e.g. "Du bist bis zum 24.10.2026 stummgeschaltet: Spam". */
export function timeoutMessage(e: TimeoutActiveError): string {
	return `Du bist bis zum ${dateFormat.format(e.until)} stummgeschaltet: ${e.reason}`;
}

/**
 * Shared error mapper for API routes (call it last in a `catch`): TimeoutActiveError becomes a 403
 * `{message}` (German text), ReportError 400 / 409 / 404. Anything else is rethrown untouched.
 */
export function mapModerationError(e: unknown): never {
	if (e instanceof TimeoutActiveError) error(403, timeoutMessage(e));
	if (e instanceof ReportError) {
		if (e.code === 'duplicate') error(409, 'Already reported');
		if (e.code === 'notfound' || e.code === 'unreportable') error(404, 'Not found');
		error(400, e.code === 'own' ? 'Own content cannot be reported' : 'Invalid report');
	}
	throw e;
}

/**
 * Form-action counterpart of the mapper. Carries the text under both `message` (upload form) and
 * `error` (quotes form), like the 429 action response in hooks.server.ts, plus the submitted values.
 */
export function timeoutFail<T extends Record<string, unknown>>(e: TimeoutActiveError, values?: T) {
	const message = timeoutMessage(e);
	return fail(403, { ...values, message, error: message });
}

/** Maps a rejected setTimeout_/liftTimeout to an HTTP error with a German message; rethrows anything else. */
export function mapTimeoutActionError(e: unknown): never {
	if (e instanceof TimeoutActionError) {
		if (e.code === 'self') error(400, 'Du kannst dich nicht selbst stummschalten.');
		if (e.code === 'forbidden') {
			error(
				403,
				'Dazu fehlt dir die Berechtigung: Moderatoren können nur Mitglieder stummschalten.'
			);
		}
		if (e.code === 'invalid') {
			error(400, 'Bitte 1 bis 30 Tage und einen Grund (höchstens 500 Zeichen) angeben.');
		}
		error(404, 'Nutzer oder aktiver Timeout nicht gefunden.');
	}
	return mapModerationError(e);
}
