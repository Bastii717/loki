import { requireModerator } from '../../lib/server/moderation-guard';
import type { LayoutServerLoad } from './$types';

/**
 * Role gate for the whole area. Child page loads and form-less APIs repeat it themselves:
 * SvelteKit runs layout and page loads in parallel and never runs a layout load for a direct call.
 * The open-case count comes from the root layout (one count per navigation, not two); the gate runs
 * first so nobody below moderator ever waits on, or sees, it.
 */
export const load: LayoutServerLoad = async ({ locals, parent }) => {
	const user = await requireModerator(locals.user);
	const { openCases } = await parent();
	return { isAdmin: user.role === 'admin', openCases: openCases ?? 0 };
};
