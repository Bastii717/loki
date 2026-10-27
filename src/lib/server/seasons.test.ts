import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { auditLog, seasonSettings } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import {
	configureSeasons,
	currentSeason,
	getSeasonSettings,
	resetSeasons,
	resolveSeason,
	SeasonInputError,
	setSeasonSettings,
	type SeasonSettings
} from './seasons';

beforeAll(setupDb);
beforeEach(resetDb);
afterEach(resetSeasons);
afterAll(resetDb);

const at = (iso: string) => new Date(iso);
const HALLOWEEN = at('2026-10-26T12:00:00.000Z');
const SEPTEMBER = at('2026-09-15T12:00:00.000Z');
const auto: SeasonSettings = { mode: 'auto', theme: null, until: null };

async function admin(): Promise<SessionUser> {
	const u = await testUser({ role: 'admin' });
	return { id: u.id, username: u.username, displayName: null, role: 'admin' };
}

describe('resolveSeason', () => {
	it('auto inside Halloween gives the calendar season', () => {
		expect(resolveSeason(auto, HALLOWEEN)).toEqual({ id: 'halloween', source: 'auto' });
	});

	it('auto outside every window gives null', () => {
		expect(resolveSeason(auto, SEPTEMBER)).toBeNull();
	});

	it('off inside Halloween gives null', () => {
		expect(resolveSeason({ mode: 'off', theme: null, until: null }, HALLOWEEN)).toBeNull();
	});

	it('forced party with a future end wins over the calendar', () => {
		const forced: SeasonSettings = {
			mode: 'forced',
			theme: 'party',
			until: at('2026-10-27T12:00:00Z')
		};
		expect(resolveSeason(forced, HALLOWEEN)).toEqual({ id: 'party', source: 'forced' });
	});

	it('forced with a past end falls back to auto (Halloween)', () => {
		const forced: SeasonSettings = {
			mode: 'forced',
			theme: 'party',
			until: at('2026-10-26T11:00:00Z')
		};
		expect(resolveSeason(forced, HALLOWEEN)).toEqual({ id: 'halloween', source: 'auto' });
	});

	it('forced whose end is exactly now has expired', () => {
		const forced: SeasonSettings = { mode: 'forced', theme: 'party', until: HALLOWEEN };
		expect(resolveSeason(forced, HALLOWEEN)).toEqual({ id: 'halloween', source: 'auto' });
	});

	it('forced without an end holds indefinitely', () => {
		const forced: SeasonSettings = { mode: 'forced', theme: 'party', until: null };
		expect(resolveSeason(forced, SEPTEMBER)).toEqual({ id: 'party', source: 'forced' });
		expect(resolveSeason(forced, HALLOWEEN)).toEqual({ id: 'party', source: 'forced' });
	});

	it('forced without a theme is not forced (defensive)', () => {
		const forced: SeasonSettings = { mode: 'forced', theme: null, until: null };
		expect(resolveSeason(forced, SEPTEMBER)).toBeNull();
	});
});

describe('getSeasonSettings', () => {
	it('returns auto defaults when nothing was saved', async () => {
		expect(await getSeasonSettings()).toEqual(auto);
	});
});

describe('setSeasonSettings', () => {
	it('rejects forced without a theme and stores nothing', async () => {
		configureSeasons({ now: () => HALLOWEEN });
		const actor = await admin();
		await expect(
			setSeasonSettings(actor, { mode: 'forced', theme: null, until: null })
		).rejects.toThrow(new SeasonInputError('Pick a theme to force.'));
		await expect(
			setSeasonSettings(actor, { mode: 'forced', theme: null, until: null })
		).rejects.toBeInstanceOf(SeasonInputError);
		expect(await db.select().from(seasonSettings)).toEqual([]);
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('rejects an unknown theme', async () => {
		configureSeasons({ now: () => HALLOWEEN });
		const actor = await admin();
		await expect(
			setSeasonSettings(actor, {
				mode: 'forced',
				theme: 'easter' as unknown as 'party',
				until: null
			})
		).rejects.toThrow('Pick a theme to force.');
	});

	it('rejects an end that is not in the future and stores nothing', async () => {
		configureSeasons({ now: () => HALLOWEEN });
		const actor = await admin();
		for (const until of [HALLOWEEN, at('2026-10-26T11:59:59Z')]) {
			await expect(
				setSeasonSettings(actor, { mode: 'forced', theme: 'party', until })
			).rejects.toThrow(new SeasonInputError('The end must be in the future.'));
		}
		expect(await db.select().from(seasonSettings)).toEqual([]);
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('stores the row and audits it with the exact detail', async () => {
		configureSeasons({ now: () => HALLOWEEN });
		const actor = await admin();
		const until = at('2026-10-27T12:00:00.000Z');
		await setSeasonSettings(actor, { mode: 'forced', theme: 'party', until });

		const [row] = await db.select().from(seasonSettings).where(eq(seasonSettings.id, 1));
		expect(row).toMatchObject({ id: 1, mode: 'forced', theme: 'party', updatedBy: actor.id });
		expect(row.until?.toISOString()).toBe(until.toISOString());
		expect(await getSeasonSettings()).toEqual({ mode: 'forced', theme: 'party', until });

		const logs = await db.select().from(auditLog);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			actorId: actor.id,
			action: 'season_changed',
			targetType: 'season_settings',
			targetId: 1,
			detail: 'mode=forced theme=party until=2026-10-27T12:00:00.000Z'
		});
	});

	it('upserts row 1 and writes none for theme and end on auto', async () => {
		configureSeasons({ now: () => HALLOWEEN });
		const actor = await admin();
		await setSeasonSettings(actor, { mode: 'forced', theme: 'party', until: null });
		await setSeasonSettings(actor, auto);

		expect(await db.select().from(seasonSettings)).toHaveLength(1);
		expect(await getSeasonSettings()).toEqual(auto);
		const logs = await db.select().from(auditLog);
		expect(logs.map((l) => l.detail)).toEqual([
			'mode=forced theme=party until=none',
			'mode=auto theme=none until=none'
		]);
	});

	it('does not require a theme or validate the end for auto and off', async () => {
		configureSeasons({ now: () => HALLOWEEN });
		const actor = await admin();
		await setSeasonSettings(actor, { mode: 'off', theme: null, until: null });
		expect(await getSeasonSettings()).toEqual({ mode: 'off', theme: null, until: null });
	});
});

describe('currentSeason cache', () => {
	function counting(settings: SeasonSettings) {
		const calls = { n: 0 };
		configureSeasons({
			load: async () => {
				calls.n += 1;
				return settings;
			}
		});
		return calls;
	}

	it('loads once for two calls within 60 s and again after', async () => {
		const calls = counting(auto);
		expect(await currentSeason(HALLOWEEN)).toEqual({ id: 'halloween', source: 'auto' });
		expect(await currentSeason(new Date(HALLOWEEN.getTime() + 59_000))).toEqual({
			id: 'halloween',
			source: 'auto'
		});
		expect(calls.n).toBe(1);
		await currentSeason(new Date(HALLOWEEN.getTime() + 60_000));
		expect(calls.n).toBe(2);
	});

	it('is cleared by setSeasonSettings', async () => {
		configureSeasons({ now: () => HALLOWEEN });
		const actor = await admin();
		expect(await currentSeason()).toEqual({ id: 'halloween', source: 'auto' });
		await setSeasonSettings(actor, { mode: 'off', theme: null, until: null });
		expect(await currentSeason()).toBeNull();
	});

	it('is cleared by setSeasonSettings (counting loader)', async () => {
		const calls = counting(auto);
		const actor = await admin();
		await currentSeason(HALLOWEEN);
		await setSeasonSettings(actor, { mode: 'off', theme: null, until: null });
		await currentSeason(HALLOWEEN);
		expect(calls.n).toBe(2);
	});

	it('never outlives a forced end that is 5 s away', async () => {
		const calls = counting({
			mode: 'forced',
			theme: 'party',
			until: new Date(HALLOWEEN.getTime() + 5_000)
		});
		expect(await currentSeason(HALLOWEEN)).toEqual({ id: 'party', source: 'forced' });
		expect(await currentSeason(new Date(HALLOWEEN.getTime() + 4_999))).toEqual({
			id: 'party',
			source: 'forced'
		});
		expect(calls.n).toBe(1);
		// After the end the forced theme has expired and the calendar takes over.
		expect(await currentSeason(new Date(HALLOWEEN.getTime() + 5_000))).toEqual({
			id: 'halloween',
			source: 'auto'
		});
		expect(calls.n).toBe(2);
	});

	it('uses the injected clock when no instant is passed', async () => {
		let now = HALLOWEEN;
		const calls = counting(auto);
		configureSeasons({ now: () => now });
		await currentSeason();
		now = new Date(HALLOWEEN.getTime() + 30_000);
		await currentSeason();
		expect(calls.n).toBe(1);
		now = new Date(HALLOWEEN.getTime() + 61_000);
		await currentSeason();
		expect(calls.n).toBe(2);
	});

	it('configureSeasons clears the cache', async () => {
		const calls = counting(auto);
		await currentSeason(HALLOWEEN);
		const calls2 = counting(auto);
		await currentSeason(HALLOWEEN);
		expect(calls.n).toBe(1);
		expect(calls2.n).toBe(1);
	});
});
