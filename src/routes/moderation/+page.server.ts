import { requireModerator } from '../../lib/server/moderation-guard';
import { listOpenCases } from '../../lib/server/moderation-queries';
import type { PageServerLoad } from './$types';

/** `?cursor=` is an integer case cursor; anything else starts from the top. */
function parseCursor(raw: string | null): number | undefined {
	const n = Number(raw);
	return raw !== null && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const actor = await requireModerator(locals.user);
	const { cases, nextCursor } = await listOpenCases(parseCursor(url.searchParams.get('cursor')));
	return {
		cases,
		nextCursor,
		viewer: { id: actor.publicId, role: actor.role } // the public id, compared with the cases' public author ids
	};
};
