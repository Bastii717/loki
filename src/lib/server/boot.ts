import { setMigrated } from './readiness';

const RETRY_INTERVAL_MS = 10_000;

/**
 * Runs the boot migrations without ever crashing the server. The first attempt is awaited; if it
 * fails the failure is reported once, `migrated` stays false and the attempt is retried every
 * `intervalMs` (not overlapping) until it succeeds, so the app keeps serving /readyz and the
 * maintenance page meanwhile.
 */
export async function migrateWithRetry(opts: {
	migrate: () => Promise<void>;
	onFailure?: (error: unknown) => void;
	intervalMs?: number;
}): Promise<void> {
	const {
		migrate,
		onFailure = (e) => console.error('migrations failed, retrying', e),
		intervalMs = RETRY_INTERVAL_MS
	} = opts;
	try {
		await migrate();
		setMigrated(true);
		return;
	} catch (e) {
		onFailure(e);
		setMigrated(false);
	}
	let running = false;
	const retry = setInterval(async () => {
		if (running) return;
		running = true;
		try {
			await migrate();
			clearInterval(retry);
			setMigrated(true);
			console.info('migrations succeeded after retry');
		} catch {
			// already reported once; the next tick tries again
		} finally {
			running = false;
		}
	}, intervalMs);
	retry.unref();
}
