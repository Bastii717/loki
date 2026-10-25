import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureReadiness, resetReadiness, setMigrated } from '../../lib/server/readiness';
import { callRoute } from '../../lib/server/test-request';
import { GET } from './+server';

beforeEach(() => {
	resetReadiness();
	setMigrated(true);
});
afterEach(resetReadiness);

const get = () => callRoute({ handler: GET, path: '/readyz' });

describe('GET /readyz', () => {
	it('is 200 with all flags true, without a session', async () => {
		configureReadiness({ dbProbe: async () => true, storageProbe: async () => true });
		const { response } = await get();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ready: true, db: true, migrated: true, storage: true });
	});

	it('is 503 when storage is down', async () => {
		configureReadiness({ dbProbe: async () => true, storageProbe: async () => false });
		const { response } = await get();
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			ready: false,
			db: true,
			migrated: true,
			storage: false
		});
	});

	it('is 503 while migrations have not succeeded', async () => {
		setMigrated(false);
		configureReadiness({ dbProbe: async () => true, storageProbe: async () => true });
		const { response } = await get();
		expect(response.status).toBe(503);
		expect((await response.json()).migrated).toBe(false);
	});

	it('never leaks probe error text', async () => {
		configureReadiness({
			dbProbe: async () => {
				throw new Error('secret-host');
			},
			storageProbe: async () => true
		});
		const { response } = await get();
		const text = await response.text();
		expect(response.status).toBe(503);
		expect(text).not.toContain('secret-host');
		expect(JSON.parse(text).db).toBe(false);
	});
});
