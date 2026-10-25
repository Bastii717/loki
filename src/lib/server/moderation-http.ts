import { error, fail } from '@sveltejs/kit';
import { ReportError, TimeoutActionError, TimeoutActiveError } from './moderation';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'Europe/Berlin'
});

/** User-facing text for a blocked write, e.g. "You are muted until 24 Oct 2026: Spam". */
export function timeoutMessage(e: TimeoutActiveError): string {
	return `You are muted until ${dateFormat.format(e.until)}: ${e.reason}`;
}

/**
 * Shared error mapper for API routes (call it last in a `catch`): TimeoutActiveError becomes a 403
 * `{message}` (English text), ReportError 400 / 409 / 404. Anything else is rethrown untouched.
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

/** Maps a rejected setTimeout_/liftTimeout to an HTTP error with an English message; rethrows anything else. */
export function mapTimeoutActionError(e: unknown): never {
	if (e instanceof TimeoutActionError) {
		if (e.code === 'self') error(400, 'You cannot mute yourself.');
		if (e.code === 'forbidden') {
			error(403, 'You lack permission for that: moderators can only mute members.');
		}
		if (e.code === 'invalid') {
			error(400, 'Please give 1 to 30 days and a reason (500 characters max).');
		}
		error(404, 'User or active timeout not found.');
	}
	return mapModerationError(e);
}
