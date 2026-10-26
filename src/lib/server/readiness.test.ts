import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	classifyStorageOutcome,
	configureReadiness,
	getReadiness,
	resetReadiness,
	setMigrated
} from './readiness';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
	resetReadiness();
	setMigrated(true);
});
afterEach(resetReadiness);

describe('classifyStorageOutcome', () => {
	it.each([
		[{ status: 200 }, true],
		[{ status: 204 }, true],
		[{ status: 404 }, true],
		[{ errorName: 'NotFound' }, true],
		[{ status: 403 }, false],
		[{ status: 500 }, false],
		[{ status: 503 }, false],
		[{ errorName: 'TimeoutError' }, false],
		[{ errorName: 'AbortError' }, false],
		[{ errorName: 'Error' }, false],
		[{}, false]
	])('%j -> %s', (outcome, expected) => {
		expect(classifyStorageOutcome(outcome)).toBe(expected);
	});
});

describe('getReadiness', () => {
	it('cachedWithinTtl: probes once inside the TTL and again after it', async () => {
		let now = 1_000_000;
		let dbCalls = 0;
		let storageCalls = 0;
		configureReadiness({
			dbProbe: async () => (dbCalls++, true),
			storageProbe: async () => (storageCalls++, true),
			now: () => now,
			ttlMs: 10_000
		});

		const first = await getReadiness();
		await getReadiness();
		expect(dbCalls).toBe(1);
		expect(storageCalls).toBe(1);
		expect(first).toMatchObject({ db: true, migrated: true, storage: true });
		expect(first.checkedAt).toEqual(new Date(1_000_000));

		now += 11_000;
		await getReadiness(); // stale value served, refresh started
		expect(dbCalls).toBe(2);
		expect(storageCalls).toBe(2);
	});

	it('sharesInFlightProbe: concurrent callers share one probe run', async () => {
		let calls = 0;
		configureReadiness({
			dbProbe: async () => {
				calls++;
				await sleep(50);
				return true;
			},
			storageProbe: async () => true
		});
		const [a, b] = await Promise.all([getReadiness(), getReadiness()]);
		expect(calls).toBe(1);
		expect(a).toEqual(b);
	});

	it('servesStaleWhileRefreshing: returns the old result while a slow probe runs', async () => {
		let now = 0;
		let dbUp = true;
		let calls = 0;
		configureReadiness({
			dbProbe: async () => {
				calls++;
				if (calls === 1) return dbUp;
				await sleep(50);
				return dbUp;
			},
			storageProbe: async () => true,
			now: () => now,
			ttlMs: 10_000
		});
		expect((await getReadiness()).db).toBe(true);

		dbUp = false;
		now += 11_000;
		const started = Date.now();
		const stale = await getReadiness();
		expect(Date.now() - started).toBeLessThan(40);
		expect(stale.db).toBe(true);
		expect(calls).toBe(2);

		// a call while the refresh is still running neither blocks nor starts another probe
		expect((await getReadiness()).db).toBe(true);
		expect(calls).toBe(2);

		await sleep(80);
		expect((await getReadiness()).db).toBe(false);
		expect(calls).toBe(2);
	});

	it('probeErrorsBecomeFalse: a rejecting probe never throws', async () => {
		configureReadiness({
			dbProbe: async () => true,
			storageProbe: async () => {
				throw new Error('secret-host');
			}
		});
		const readiness = await getReadiness();
		expect(readiness.storage).toBe(false);
		expect(readiness.db).toBe(true);
		expect(JSON.stringify(readiness)).not.toContain('secret-host');
	});

	it('migratedFlag: follows setMigrated immediately, even inside the TTL', async () => {
		configureReadiness({ dbProbe: async () => true, storageProbe: async () => true });
		setMigrated(false);
		expect((await getReadiness()).migrated).toBe(false);
		setMigrated(true);
		expect((await getReadiness()).migrated).toBe(true);
	});
});
