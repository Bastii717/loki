import { fail } from '@sveltejs/kit';
import { formatDateTime } from '../../../lib/moderation-labels';
import { SEASONS, seasonById, type SeasonId } from '../../../lib/seasons';
import { fromBerlinLocal, toBerlinLocal } from '../../../lib/server/berlin-time';
import { requireModerator } from '../../../lib/server/moderation-guard';
import {
	getSeasonSettings,
	resolveSeason,
	SeasonInputError,
	setSeasonSettings,
	type SeasonSettings
} from '../../../lib/server/seasons';
import type { Actions, PageServerLoad } from './$types';

const INVALID_DATE = 'Enter a valid date and time.';

function statusLine(settings: SeasonSettings, now: Date): string {
	const active = resolveSeason(settings, now);
	if (!active) return `Active: none (${settings.mode === 'off' ? 'off' : 'automatic'})`;
	const label = seasonById(active.id)?.label ?? active.id;
	if (active.source === 'auto') return `Active: ${label} (automatic)`;
	return settings.until
		? `Active: ${label} (forced until ${formatDateTime(settings.until.toISOString())})`
		: `Active: ${label} (forced)`;
}

export const load: PageServerLoad = async ({ locals }) => {
	await requireModerator(locals.user, 'admin');
	const settings = await getSeasonSettings();
	const now = new Date();
	return {
		mode: settings.mode,
		theme: settings.theme ?? '',
		// `datetime-local` value, in Berlin time
		until: settings.until ? toBerlinLocal(settings.until) : '',
		active: resolveSeason(settings, now),
		status: statusLine(settings, now),
		seasons: SEASONS.map(({ id, label }) => ({ id, label }))
	};
};

/** A `datetime-local` form value: empty is none, anything malformed is an input error. */
function parseLocal(value: string): Date | null {
	const text = value.trim();
	if (!text) return null;
	try {
		return fromBerlinLocal(text);
	} catch {
		throw new SeasonInputError(INVALID_DATE);
	}
}

export const actions: Actions = {
	save: async ({ locals, request }) => {
		const actor = await requireModerator(locals.user, 'admin');
		const data = await request.formData();
		const rawMode = String(data.get('mode') ?? '');
		const raw = {
			mode: (rawMode === 'forced' || rawMode === 'off'
				? rawMode
				: 'auto') as SeasonSettings['mode'],
			theme: String(data.get('theme') ?? ''),
			until: String(data.get('until') ?? '')
		};
		try {
			// The theme and the end only mean something when forcing; the server rejects a past end
			// for every mode, so a stale value left in the form must not travel with auto or off.
			const forced = raw.mode === 'forced';
			await setSeasonSettings(actor, {
				mode: raw.mode,
				theme: forced && seasonById(raw.theme) ? (raw.theme as SeasonId) : null,
				until: forced ? parseLocal(raw.until) : null
			});
		} catch (e) {
			if (e instanceof SeasonInputError) return fail(400, { error: e.message, ...raw });
			throw e;
		}
		return { saved: true };
	},

	reset: async ({ locals }) => {
		const actor = await requireModerator(locals.user, 'admin');
		await setSeasonSettings(actor, { mode: 'auto', theme: null, until: null });
		return { saved: true };
	}
};
