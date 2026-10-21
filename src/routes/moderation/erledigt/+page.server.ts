import { requireModerator } from '../../../lib/server/moderation-guard';
import { listDoneCases } from '../../../lib/server/moderation-queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireModerator(locals.user);
	return listDoneCases(url.searchParams.get('cursor') ?? undefined);
};
