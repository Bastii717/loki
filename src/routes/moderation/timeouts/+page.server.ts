import { MAX_TIMEOUT_DAYS, MAX_TIMEOUT_REASON } from '../../../lib/server/moderation';
import { requireModerator } from '../../../lib/server/moderation-guard';
import { listActiveTimeouts } from '../../../lib/server/moderation-queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const actor = await requireModerator(locals.user);
	const active = await listActiveTimeouts();
	return {
		// moderators may only lift timeouts of members (same matrix as setting them), nobody their own
		timeouts: active.map((t) => ({
			...t,
			canLift: t.publicId !== actor.publicId && (actor.role === 'admin' || t.role === 'member')
		})),
		limits: { days: MAX_TIMEOUT_DAYS, reason: MAX_TIMEOUT_REASON }
	};
};
