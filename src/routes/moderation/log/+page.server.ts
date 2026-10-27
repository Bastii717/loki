import { AUDIT_ACTIONS, listAudit } from '../../../lib/server/moderation';
import { requireModerator } from '../../../lib/server/moderation-guard';
import { namesById } from '../../../lib/server/moderation-queries';
import type { PageServerLoad } from './$types';

const KNOWN_ACTIONS: string[] = Object.values(AUDIT_ACTIONS);

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireModerator(locals.user);

	const rawAction = url.searchParams.get('action');
	const action = rawAction !== null && KNOWN_ACTIONS.includes(rawAction) ? rawAction : undefined;
	const rawCursor = Number(url.searchParams.get('cursor'));
	const cursor = Number.isSafeInteger(rawCursor) && rawCursor > 0 ? rawCursor : undefined;

	const { entries, nextCursor } = await listAudit({ action }, cursor);
	const names = await namesById(
		entries.filter((e) => e.targetType === 'user').map((e) => e.targetId)
	);
	return {
		action: action ?? '',
		// content_released is defined but never written (a release logs report_dismissed): no filter entry
		actions: KNOWN_ACTIONS.filter((a) => a !== AUDIT_ACTIONS.contentReleased),
		nextCursor,
		entries: entries.map((e) => ({
			id: e.id,
			actor: e.actorName,
			action: e.action,
			targetType: e.targetType,
			targetId: e.targetId,
			targetName: e.targetType === 'user' ? (names.get(e.targetId)?.username ?? null) : null,
			targetDisplay: e.targetType === 'user' ? (names.get(e.targetId)?.display ?? null) : null,
			detail: e.detail,
			createdAt: e.createdAt.toISOString()
		}))
	};
};
