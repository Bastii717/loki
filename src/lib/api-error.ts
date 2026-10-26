/** Shown for a 503 that carries no message of its own (e.g. the HTML outage page while the database is down). */
export const BREAK_MESSAGE = 'Loki is taking a break. Try again in a moment.';

/**
 * The user-facing message the API sent with a rejected write (`{message}`: the timeout notice on
 * 403, the maintenance notice on 503), or `fallback` for anything else. Only 403 and 503 carry
 * user-facing text; other bodies are technical English and stay hidden. A 503 without a usable
 * `{message}` (the outage page is HTML) is never silent: it answers `BREAK_MESSAGE`.
 */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
	if (res.status !== 403 && res.status !== 503) return fallback;
	const unusable = res.status === 503 ? BREAK_MESSAGE : fallback;
	try {
		const body = (await res.json()) as { message?: unknown };
		return typeof body.message === 'string' && body.message !== '' ? body.message : unusable;
	} catch {
		return unusable;
	}
}
