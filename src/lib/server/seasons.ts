import { eq } from 'drizzle-orm';
import { seasonById, type SeasonId } from '../seasons';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { seasonSettings } from './db/schema';
import { AUDIT_ACTIONS, audit } from './moderation';
import { seasonForDate } from './season-dates';

export interface SeasonSettings {
	mode: 'auto' | 'off' | 'forced';
	theme: SeasonId | null;
	until: Date | null;
}

export interface ResolvedSeason {
	id: SeasonId;
	source: 'auto' | 'forced';
}

const ROW_ID = 1;
const CACHE_TTL_MS = 60_000;

/** Rejected setSeasonSettings input. The message is user-facing. */
export class SeasonInputError extends Error {}

const DEFAULT_SETTINGS: SeasonSettings = { mode: 'auto', theme: null, until: null };

async function loadSettings(): Promise<SeasonSettings> {
	const [row] = await db
		.select({
			mode: seasonSettings.mode,
			theme: seasonSettings.theme,
			until: seasonSettings.until
		})
		.from(seasonSettings)
		.where(eq(seasonSettings.id, ROW_ID));
	if (!row) return { ...DEFAULT_SETTINGS };
	const theme = row.theme && seasonById(row.theme) ? (row.theme as SeasonId) : null;
	return { mode: row.mode, theme, until: row.until };
}

let load: () => Promise<SeasonSettings> = loadSettings;
let clock: () => Date = () => new Date();

interface CacheEntry {
	value: ResolvedSeason | null;
	checkedAt: number;
	ttl: number;
}

let cache: CacheEntry | null = null;
/** Bumped on every invalidation so a load that started before it cannot repopulate the cache. */
let generation = 0;

function clearCache(): void {
	cache = null;
	generation += 1;
}

/** Test injection of the settings loader and the clock. Clears the cache. */
export function configureSeasons(opts: {
	load?: () => Promise<SeasonSettings>;
	now?: () => Date;
}): void {
	if (opts.load) load = opts.load;
	if (opts.now) clock = opts.now;
	clearCache();
}

/** Restores the database loader and the real clock, and clears the cache. */
export function resetSeasons(): void {
	load = loadSettings;
	clock = () => new Date();
	clearCache();
}

/** The admin settings row (id 1); defaults (auto) when it was never saved. */
export function getSeasonSettings(): Promise<SeasonSettings> {
	return load();
}

/** Saves the settings (upsert of row 1) and audits it in the same transaction. */
export async function setSeasonSettings(actor: SessionUser, input: SeasonSettings): Promise<void> {
	if (input.mode === 'forced' && !(input.theme && seasonById(input.theme))) {
		throw new SeasonInputError('Pick a theme to force.');
	}
	if (input.until && input.until.getTime() <= clock().getTime()) {
		throw new SeasonInputError('The end must be in the future.');
	}
	const values = {
		mode: input.mode,
		theme: input.theme,
		until: input.until,
		updatedBy: actor.id,
		updatedAt: new Date()
	};
	const detail =
		`mode=${input.mode} theme=${input.theme ?? 'none'} ` +
		`until=${input.until?.toISOString() ?? 'none'}`;
	await db.transaction(async (tx) => {
		await tx
			.insert(seasonSettings)
			.values({ id: ROW_ID, ...values })
			.onConflictDoUpdate({ target: seasonSettings.id, set: values });
		await audit(actor.id, AUDIT_ACTIONS.seasonChanged, 'season_settings', ROW_ID, detail, tx);
	});
	clearCache();
}

/**
 * Precedence: an unexpired forced theme wins; `off` disables everything; otherwise (auto, or a
 * forced theme whose `until` has passed) the calendar decides.
 */
export function resolveSeason(settings: SeasonSettings, now: Date): ResolvedSeason | null {
	if (settings.mode === 'off') return null;
	if (settings.mode === 'forced' && settings.theme) {
		const expired = settings.until !== null && settings.until.getTime() <= now.getTime();
		if (!expired) return { id: settings.theme, source: 'forced' };
	}
	const id = seasonForDate(now);
	return id ? { id, source: 'auto' } : null;
}

/** How long a resolution made at `now` stays valid: 60 s, never past a forced theme's end. */
function ttlFor(settings: SeasonSettings, now: Date): number {
	if (settings.mode === 'forced' && settings.until) {
		const left = settings.until.getTime() - now.getTime();
		if (left > 0) return Math.min(CACHE_TTL_MS, left);
	}
	return CACHE_TTL_MS;
}

/** The active season for the instant, cached for up to 60 s (shorter when a forced end is near). */
export async function currentSeason(now?: Date): Promise<ResolvedSeason | null> {
	const at = now ?? clock();
	const nowMs = at.getTime();
	if (cache && nowMs >= cache.checkedAt && nowMs - cache.checkedAt < cache.ttl) {
		return cache.value;
	}
	const started = generation;
	const settings = await load();
	const value = resolveSeason(settings, at);
	if (started === generation) {
		cache = { value, checkedAt: nowMs, ttl: ttlFor(settings, at) };
	}
	return value;
}
