import { requireModerator } from '../../lib/server/moderation-guard';
import { countOpenCases } from '../../lib/server/moderation-queries';
import type { LayoutServerLoad } from './$types';

/**
 * Role gate for the whole area. Child page loads and form-less APIs repeat it themselves:
 * SvelteKit runs layout and page loads in parallel and never runs a layout load for a direct call.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const user = await requireModerator(locals.user);
	return { isAdmin: user.role === 'admin', openCases: await countOpenCases() };
};
