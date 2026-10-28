import { sql } from 'drizzle-orm';
import { awardDueMonths } from './awards';
import { db } from './db';
import { sweepNotifications } from './notifications';
import { getReadiness } from './readiness';

const INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AWARD_INTERVAL_MS = 60 * 60 * 1000;

/** Hacker-News style decay: score / (age in hours + 2) ^ 1.5. */
export async function recomputeHotScores(): Promise<void> {
	await db.execute(
		sql`UPDATE media SET hot_score = score / POWER(EXTRACT(EPOCH FROM (now() - created_at)) / 3600 + 2, 1.5)`
	);
}

/** The hot-score job only runs while the database is reachable and migrated. */
export async function hotScoreJobShouldRun(): Promise<boolean> {
	const readiness = await getReadiness();
	return readiness.db && readiness.migrated;
}

/** Retention sweep of old notifications; runs on the same readiness guard as the hot-score job. */
export async function runSweep(): Promise<void> {
	if (!(await hotScoreJobShouldRun())) return;
	await sweepNotifications().catch((e) => console.error('notification sweep failed', e));
}

/** Awards the finished months that have no award yet; same readiness guard as the other jobs. */
export async function runAwards(): Promise<void> {
	if (!(await hotScoreJobShouldRun())) return;
	await awardDueMonths().catch((e) => console.error('award run failed', e));
}

let timers: ReturnType<typeof setInterval>[] | undefined;

/** Starts the periodic jobs (hot scores every 5 minutes, the awards hourly, the notification sweep daily); calling it again is a no-op. */
export function startJobs(): void {
	if (timers) return;
	const runHotScores = async () => {
		if (!(await hotScoreJobShouldRun())) return;
		await recomputeHotScores().catch((e) => console.error('hot score recompute failed', e));
	};
	void runHotScores();
	void runSweep();
	void runAwards();
	timers = [
		setInterval(runHotScores, INTERVAL_MS),
		setInterval(runSweep, SWEEP_INTERVAL_MS),
		setInterval(runAwards, AWARD_INTERVAL_MS)
	];
	for (const timer of timers) timer.unref();
}
