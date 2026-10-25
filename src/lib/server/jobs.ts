import { sql } from 'drizzle-orm';
import { db } from './db';
import { getReadiness } from './readiness';

const INTERVAL_MS = 5 * 60 * 1000;

/** Hacker-News style decay: score / (age in hours + 2) ^ 1.5. */
export async function recomputeHotScores(): Promise<void> {
	await db.execute(
		sql`UPDATE media SET hot_score = score / POWER(EXTRACT(EPOCH FROM (now() - created_at)) / 3600 + 2, 1.5)`
	);
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Starts the periodic jobs; calling it again is a no-op. */
export function startJobs(): void {
	if (timer) return;
	const run = async () => {
		const ready = await getReadiness();
		if (!ready.db || !ready.migrated) return;
		await recomputeHotScores().catch((e) => console.error('hot score recompute failed', e));
	};
	void run();
	timer = setInterval(run, INTERVAL_MS);
	timer.unref();
}
