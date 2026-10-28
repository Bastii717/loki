import { AUDIT_ACTIONS, listAudit } from '../../../lib/server/moderation';
import { requireModerator } from '../../../lib/server/moderation-guard';
import { namesById, targetPublicIds } from '../../../lib/server/moderation-queries';
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
	const publicIds = await targetPublicIds(entries);
	return {
		action: action ?? '',
		// content_released is defined but never written (a release logs report_dismissed): no filter entry
		actions: KNOWN_ACTIONS.filter((a) => a !== AUDIT_ACTIONS.contentReleased),
		nextCursor,
		entries: entries.map((e) => ({
			// the audit row's own id (list key and cursor), neither a user nor a content id
			id: e.id,
			actor: e.actorName,
			action: e.action,
			targetType: e.targetType,
			// the target's public id; null when it is gone or has none (site content, maintenance, ...)
			targetId: publicIds.get(`${e.targetType}:${e.targetId}`) ?? null,
			targetName: e.targetType === 'user' ? (names.get(e.targetId)?.username ?? null) : null,
			targetRole: e.targetType === 'user' ? (names.get(e.targetId)?.role ?? null) : null,
			targetDisplay: e.targetType === 'user' ? (names.get(e.targetId)?.display ?? null) : null,
			detail: e.detail,
			createdAt: e.createdAt.toISOString()
		}))
	};
};
