const POLL_MS = 60_000;
const MIN_DELAY_MS = 1_000;
const SETTLE_MS = 1_000;

/**
 * Milliseconds until the client should ask the server for the status again, or null when there
 * is nothing to watch (`ok`). While a lock is shown it polls every minute, sooner when the
 * window is known to start or end earlier (one second after `nextChangeAt`), never faster than
 * once per second.
 */
export function nextRefreshDelay(
	status: { state: string; nextChangeAt: string | null },
	now: number
): number | null {
	if (status.state === 'ok') return null;
	if (status.nextChangeAt === null) return POLL_MS;
	const until = Date.parse(status.nextChangeAt) - now + SETTLE_MS;
	if (Number.isNaN(until)) return POLL_MS;
	return Math.max(MIN_DELAY_MS, Math.min(POLL_MS, until));
}
