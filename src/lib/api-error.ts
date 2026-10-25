/**
 * The user-facing message the API sent with a rejected write (`{message}`, e.g. the timeout notice on
 * 403), or `fallback` for anything else. Only 403 carries user-facing text; other bodies are
 * technical English and stay hidden.
 */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
	if (res.status !== 403) return fallback;
	try {
		const body = (await res.json()) as { message?: unknown };
		return typeof body.message === 'string' && body.message !== '' ? body.message : fallback;
	} catch {
		return fallback;
	}
}
