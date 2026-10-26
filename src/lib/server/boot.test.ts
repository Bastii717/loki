import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateWithRetry } from './boot';
import { configureReadiness, getReadiness, resetReadiness } from './readiness';

const migrated = async () => (await getReadiness()).migrated;

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, 'info').mockImplementation(() => {});
	configureReadiness({ dbProbe: async () => true, storageProbe: async () => true });
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	resetReadiness();
});

describe('migrateWithRetry', () => {
	it('marks migrated right away when the first attempt succeeds', async () => {
		const migrate = vi.fn().mockResolvedValue(undefined);
		const onFailure = vi.fn();
		await migrateWithRetry({ migrate, onFailure });
		expect(await migrated()).toBe(true);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(migrate).toHaveBeenCalledTimes(1);
		expect(onFailure).not.toHaveBeenCalled();
	});

	it('reports once, retries every interval and stops after the first success', async () => {
		const migrate = vi
			.fn()
			.mockRejectedValueOnce(new Error('down'))
			.mockRejectedValueOnce(new Error('still down'))
			.mockResolvedValue(undefined);
		const onFailure = vi.fn();

		await migrateWithRetry({ migrate, onFailure });
		expect(await migrated()).toBe(false);
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(migrate).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(10_000);
		expect(migrate).toHaveBeenCalledTimes(2);
		expect(await migrated()).toBe(false);

		await vi.advanceTimersByTimeAsync(10_000);
		expect(migrate).toHaveBeenCalledTimes(3);
		expect(await migrated()).toBe(true);
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(console.info).toHaveBeenCalledWith('migrations succeeded after retry');

		await vi.advanceTimersByTimeAsync(10_000);
		expect(migrate).toHaveBeenCalledTimes(3);
	});

	it('does not start a second attempt while one is still pending', async () => {
		let release!: () => void;
		const migrate = vi
			.fn()
			.mockRejectedValueOnce(new Error('down'))
			.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
			.mockResolvedValue(undefined);

		await migrateWithRetry({ migrate, onFailure: () => {} });
		await vi.advanceTimersByTimeAsync(10_000);
		expect(migrate).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(10_000); // tick while the retry is pending
		expect(migrate).toHaveBeenCalledTimes(2);
		expect(await migrated()).toBe(false);

		release();
		await vi.advanceTimersByTimeAsync(0);
		expect(await migrated()).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(migrate).toHaveBeenCalledTimes(2);
	});
});
