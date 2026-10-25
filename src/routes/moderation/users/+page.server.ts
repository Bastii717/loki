import { requireModerator } from '../../../lib/server/moderation-guard';
import { listUserOverview } from '../../../lib/server/moderation-queries';
import type { PageServerLoad } from './$types';

/** The full user list is admin-only (design: decision basis for the out-of-app "Rauswurf"). */
export const load: PageServerLoad = async ({ locals }) => {
	await requireModerator(locals.user, 'admin');
	return { users: await listUserOverview() };
};
