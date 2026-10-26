import { BREAK_MESSAGE } from './api-error';

export type ModResult = { ok: true } | { ok: false; message: string };

/**
 * JSON request against a moderation API. The moderation endpoints answer errors with an English
 * `{message}` (SvelteKit error body), which is shown as is; anything else falls back to `fallback`.
 */
export async function modRequest(
	url: string,
	method: 'POST' | 'DELETE',
	body?: unknown,
	fallback = "That didn't work. Please try again."
): Promise<ModResult> {
	try {
		const res = await fetch(url, {
			method,
			headers: body === undefined ? undefined : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (res.ok) return { ok: true };
		// a 503 that is not a JSON `{message}` is the outage page: never leave it silent
		let message = res.status === 503 ? BREAK_MESSAGE : fallback;
		try {
			const parsed = (await res.json()) as { message?: unknown; error?: unknown };
			const text = parsed.message ?? parsed.error;
			if (typeof text === 'string' && text !== '') message = text;
		} catch {
			// not JSON: keep the default
		}
		return { ok: false, message };
	} catch {
		return { ok: false, message: fallback };
	}
}
