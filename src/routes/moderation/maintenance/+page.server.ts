import { fail } from '@sveltejs/kit';
import { fromBerlinLocal, toBerlinLocal } from '../../../lib/server/berlin-time';
import {
	getMaintenance,
	MAX_MAINTENANCE_MESSAGE,
	MaintenanceInputError,
	resolveState,
	setMaintenance,
	statusMessage
} from '../../../lib/server/maintenance';
import { requireModerator } from '../../../lib/server/moderation-guard';
import { getReadiness } from '../../../lib/server/readiness';
import type { Actions, PageServerLoad } from './$types';

const INVALID_DATE = 'Enter a valid date and time.';

export const load: PageServerLoad = async ({ locals }) => {
	await requireModerator(locals.user, 'admin');
	const row = await getMaintenance();
	const state = resolveState(await getReadiness(), row, new Date());
	return {
		enabled: row.enabled,
		message: row.message,
		// `datetime-local` values, in Berlin time
		startsAt: row.startsAt ? toBerlinLocal(row.startsAt) : '',
		until: row.until ? toBerlinLocal(row.until) : '',
		state,
		preview: {
			admin: statusMessage(state, row, 'admin'),
			member: statusMessage(state, row, 'member')
		},
		maxMessage: MAX_MAINTENANCE_MESSAGE
	};
};

/** A `datetime-local` form value: empty is none, anything malformed is an input error. */
function parseLocal(value: FormDataEntryValue | null): Date | null {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) return null;
	try {
		return fromBerlinLocal(text);
	} catch {
		throw new MaintenanceInputError(INVALID_DATE);
	}
}

export const actions: Actions = {
	save: async ({ locals, request }) => {
		const actor = await requireModerator(locals.user, 'admin');
		const data = await request.formData();
		const raw = {
			enabled: data.get('enabled') === 'on',
			// browsers submit textarea line breaks as CRLF; count them like the client does
			message: String(data.get('message') ?? '').replace(/\r\n/g, '\n'),
			startsAt: String(data.get('startsAt') ?? ''),
			until: String(data.get('until') ?? '')
		};
		try {
			await setMaintenance(actor, {
				enabled: raw.enabled,
				message: raw.message.trim(),
				startsAt: parseLocal(raw.startsAt),
				until: parseLocal(raw.until)
			});
		} catch (e) {
			if (e instanceof MaintenanceInputError) return fail(400, { error: e.message, ...raw });
			throw e;
		}
		return { saved: true };
	},

	off: async ({ locals }) => {
		const actor = await requireModerator(locals.user, 'admin');
		await setMaintenance(actor, { enabled: false, message: '', startsAt: null, until: null });
		return { saved: true };
	}
};
