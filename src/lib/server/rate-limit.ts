/**
 * In-memory sliding-window rate limiter.
 *
 * Limitation: state lives in this process only. Loki runs as a single container, so
 * that is exact; with multiple replicas each would enforce its own window (limits would
 * effectively multiply) and a restart resets all counters. Move to a shared store
 * (e.g. Postgres or Redis) before scaling horizontally.
 */
const hits = new Map<string, number[]>();
let lastSweep = 0;
const SWEEP_EVERY_MS = 60_000;
const MAX_WINDOW_MS = 60 * 60 * 1000;

/**
 * Records a call for `key` unless it exceeded `limit` per `windowMs`. Returns 0 when the call
 * is allowed, otherwise the milliseconds until the window has room again.
 */
export function rateLimitRetryMs(key: string, limit: number, windowMs: number): number {
	const now = Date.now();
	sweep(now);
	const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
	if (recent.length >= limit) {
		hits.set(key, recent);
		// room opens once enough old hits have left the window to get back under the limit
		return Math.max(1, recent[recent.length - limit] + windowMs - now);
	}
	recent.push(now);
	hits.set(key, recent);
	return 0;
}

/** Returns true if the call is allowed (and records it), false if `key` exceeded `limit` per `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
	return rateLimitRetryMs(key, limit, windowMs) === 0;
}

/** Drops stale keys so the map cannot grow without bound. */
function sweep(now: number): void {
	if (now - lastSweep < SWEEP_EVERY_MS) return;
	lastSweep = now;
	for (const [key, times] of hits) {
		if (times.length === 0 || now - times[times.length - 1] >= MAX_WINDOW_MS) hits.delete(key);
	}
}

/** Test helper: forget all recorded calls. */
export function resetRateLimits(): void {
	hits.clear();
	lastSweep = 0;
}
