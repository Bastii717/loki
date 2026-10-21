import { error } from '@sveltejs/kit';
import {
	MAX_TIMEOUT_DAYS,
	MAX_TIMEOUT_REASON,
	setTimeout_
} from '../../../../lib/server/moderation';
import { requireModerator } from '../../../../lib/server/moderation-guard';
import { mapTimeoutActionError } from '../../../../lib/server/moderation-http';
import type { RequestHandler } from './$types';

/** Sets (or replaces) a timeout on a user: moderators and admins, within the role matrix of setTimeout_. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const actor = await requireModerator(locals.user);

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, 'Ungültige Anfrage.');
	}
	const { userId, days, reason } = (raw ?? {}) as Record<string, unknown>;
	if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
		error(400, 'Bitte einen Nutzer auswählen.');
	}
	if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_TIMEOUT_DAYS) {
		error(400, `Bitte 1 bis ${MAX_TIMEOUT_DAYS} Tage angeben.`);
	}
	if (typeof reason !== 'string' || reason.trim() === '' || reason.length > MAX_TIMEOUT_REASON) {
		error(400, `Bitte einen Grund (höchstens ${MAX_TIMEOUT_REASON} Zeichen) angeben.`);
	}

	try {
		await setTimeout_(actor, userId, days, reason);
	} catch (e) {
		mapTimeoutActionError(e);
	}
	return new Response(null, { status: 204 });
};
