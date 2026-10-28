import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as awardsModule from './awards';
import { db } from './db';
import { media } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import {
	AWARD_INTERVAL_MS,
	hotScoreJobShouldRun,
	recomputeHotScores,
	runAwards,
	runSweep,
	startJobs
} from './jobs';
import * as notificationsModule from './notifications';
import { configureReadiness, resetReadiness, setMigrated } from './readiness';

beforeAll(setupDb);
beforeEach(resetDb);

const HOUR = 60 * 60 * 1000;

async function insertMedia(uploaderId: number, ageHours: number, score: number) {
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			kind: 'image',
			objectKey: `k${ageHours}`,
			thumbKey: `t${ageHours}`,
			score,
			createdAt: new Date(Date.now() - ageHours * HOUR)
		})
		.returning();
	return row;
}

describe('recomputeHotScores', () => {
	it('ranks a newer meme above an older one with equal score', async () => {
		const user = await testUser();
		const older = await insertMedia(user.id, 48, 10);
		const newer = await insertMedia(user.id, 1, 10);
		await recomputeHotScores();
		const [o] = await db.select().from(media).where(eq(media.id, older.id));
		const [n] = await db.select().from(media).where(eq(media.id, newer.id));
		expect(n.hotScore).toBeGreaterThan(o.hotScore);
		expect(n.hotScore).toBeCloseTo(10 / Math.pow(3, 1.5), 2);
	});
});

describe('hotScoreJobShouldRun', () => {
	afterEach(() => {
		resetReadiness();
		setMigrated(true);
	});

	const configure = (dbUp: boolean) =>
		configureReadiness({ dbProbe: async () => dbUp, storageProbe: async () => false });

	it('runs when the database is up and migrated, whatever the storage says', async () => {
		setMigrated(true);
		configure(true);
		expect(await hotScoreJobShouldRun()).toBe(true);
	});

	it('skips while migrations have not succeeded', async () => {
		setMigrated(false);
		configure(true);
		expect(await hotScoreJobShouldRun()).toBe(false);
	});

	it('skips while the database is down', async () => {
		setMigrated(true);
		configure(false);
		expect(await hotScoreJobShouldRun()).toBe(false);
	});
});

describe('notification sweep job', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		resetReadiness();
		setMigrated(true);
	});

	const configure = (dbUp: boolean) =>
		configureReadiness({ dbProbe: async () => dbUp, storageProbe: async () => false });

	it('sweeps while the database is up and migrated', async () => {
		const sweep = vi.spyOn(notificationsModule, 'sweepNotifications').mockResolvedValue(0);
		setMigrated(true);
		configure(true);
		await runSweep();
		expect(sweep).toHaveBeenCalledTimes(1);
	});

	it('skips while migrations have not succeeded', async () => {
		const sweep = vi.spyOn(notificationsModule, 'sweepNotifications').mockResolvedValue(0);
		setMigrated(false);
		configure(true);
		await runSweep();
		expect(sweep).not.toHaveBeenCalled();
	});

	it('skips while the database is down', async () => {
		const sweep = vi.spyOn(notificationsModule, 'sweepNotifications').mockResolvedValue(0);
		setMigrated(true);
		configure(false);
		await runSweep();
		expect(sweep).not.toHaveBeenCalled();
	});

	it('logs a failed sweep instead of throwing', async () => {
		vi.spyOn(notificationsModule, 'sweepNotifications').mockRejectedValue(new Error('boom'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		setMigrated(true);
		configure(true);
		await expect(runSweep()).resolves.toBeUndefined();
		expect(log).toHaveBeenCalledWith('notification sweep failed', expect.any(Error));
	});

	it('startJobs runs the sweep once at start, and a second call changes nothing', async () => {
		const sweep = vi.spyOn(notificationsModule, 'sweepNotifications').mockResolvedValue(0);
		const awardRun = vi.spyOn(awardsModule, 'awardDueMonths').mockResolvedValue([]);
		setMigrated(true);
		configure(true);
		startJobs();
		startJobs();
		await vi.waitFor(() => expect(sweep).toHaveBeenCalled());
		await vi.waitFor(() => expect(awardRun).toHaveBeenCalled());
		expect(sweep).toHaveBeenCalledTimes(1);
		expect(awardRun).toHaveBeenCalledTimes(1);
	});
});

describe('awards job', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		resetReadiness();
		setMigrated(true);
	});

	const configure = (dbUp: boolean) =>
		configureReadiness({ dbProbe: async () => dbUp, storageProbe: async () => false });

	it('awards while the database is up and migrated', async () => {
		const run = vi.spyOn(awardsModule, 'awardDueMonths').mockResolvedValue([]);
		setMigrated(true);
		configure(true);
		await runAwards();
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('skips while migrations have not succeeded', async () => {
		const run = vi.spyOn(awardsModule, 'awardDueMonths').mockResolvedValue([]);
		setMigrated(false);
		configure(true);
		await runAwards();
		expect(run).not.toHaveBeenCalled();
	});

	it('skips while the database is down', async () => {
		const run = vi.spyOn(awardsModule, 'awardDueMonths').mockResolvedValue([]);
		setMigrated(true);
		configure(false);
		await runAwards();
		expect(run).not.toHaveBeenCalled();
	});

	it('logs a failed run instead of throwing', async () => {
		vi.spyOn(awardsModule, 'awardDueMonths').mockRejectedValue(new Error('boom'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		setMigrated(true);
		configure(true);
		await expect(runAwards()).resolves.toBeUndefined();
		expect(log).toHaveBeenCalledWith('award run failed', expect.any(Error));
	});

	it('runs hourly', () => {
		expect(AWARD_INTERVAL_MS).toBe(60 * 60 * 1000);
	});
});
