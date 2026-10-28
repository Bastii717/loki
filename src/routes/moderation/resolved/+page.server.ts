import { requireModerator } from '../../../lib/server/moderation-guard';
import { listDoneCases, type DoneCase } from '../../../lib/server/moderation-queries';
import type { PageServerLoad } from './$types';

/** Resolved cases are read-only: the internal content id stays on the server. */
function withoutContentId(c: DoneCase): Omit<DoneCase, 'contentId'> {
	const copy: Partial<DoneCase> = { ...c };
	delete copy.contentId;
	return copy as Omit<DoneCase, 'contentId'>;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireModerator(locals.user);
	const { cases, nextCursor } = await listDoneCases(url.searchParams.get('cursor') ?? undefined);
	return { cases: cases.map(withoutContentId), nextCursor };
};
