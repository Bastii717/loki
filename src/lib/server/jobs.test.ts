import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { media } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { hotScoreJobShouldRun, recomputeHotScores } from './jobs';
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
