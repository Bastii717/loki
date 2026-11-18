import { requireModerator } from '../../../lib/server/moderation-guard';
import { listUserOverview } from '../../../lib/server/moderation-queries';
import type { PageServerLoad } from './$types';

/** The full user list is admin-only (design: the numbers inform the decision to remove someone, which happens in the identity provider). */
export const load: PageServerLoad = async ({ locals }) => {
	await requireModerator(locals.user, 'admin');
	return { users: await listUserOverview() };
};
