import type { SessionUser } from './auth/session';
import { deleteComment } from './comments';
import { deleteMedia, setFlags } from './memes';
import { audit, AUDIT_ACTIONS, resolveReports, setTimeout_, type ContentType } from './moderation';
import { getOpenCase } from './moderation-queries';
import { deleteQuote } from './quotes';

export type CaseErrorCode = 'notfound' | 'invalid';

/** 'notfound' = the content has no open reports (anymore); 'invalid' = action does not fit the content. */
export class CaseError extends Error {
	constructor(readonly code: CaseErrorCode) {
		super(`Case action rejected: ${code}`);
	}
}

export type CaseAction =
	| { type: 'release' }
	| { type: 'flags' }
	| { type: 'delete' }
	| { type: 'timeout'; days: number; reason: string };

/**
 * Queue actions on one case. The CALLER must have verified the actor's moderator role and that
 * the actor is not timed out (requireModerator); the underlying modules trust `actor`.
 *
 * Every action requires an open case (a double click or a second moderator gets 'notfound'), then
 * performs the concrete mutation through the existing module, writes the audit row for it and
 * finally closes the reports with the matching outcome:
 * - release: resolveReports 'dismissed' (stamps reviewedAt, audits report_dismissed itself)
 * - flags:   setFlags nsfw (memes only) + audit flags_forced + 'actioned'
 * - delete:  deleteMedia/Comment/Quote + audit content_deleted + 'actioned'
 * - timeout: setTimeout_ on the author (audits timeout_set itself) + 'actioned'
 * The mutation comes first so a failed one (permission, timeout rules, vanished content) leaves
 * the case open; if closing the reports fails afterwards, the case stays open and can be released.
 */
export async function actOnCase(
	actor: SessionUser,
	contentType: ContentType,
	contentId: number,
	action: CaseAction
): Promise<void> {
	const open = await getOpenCase(contentType, contentId);
	if (!open) throw new CaseError('notfound');

	switch (action.type) {
		case 'release':
			await resolveReports(actor, contentType, contentId, 'dismissed');
			return;

		case 'flags':
			if (contentType !== 'meme') throw new CaseError('invalid');
			await setFlags(actor, contentId, { nsfw: true });
			await audit(
				actor.id,
				AUDIT_ACTIONS.flagsForced,
				contentType,
				contentId,
				`NSFW erzwungen, ${open.author}: ${open.excerpt}`
			);
			break;

		case 'delete':
			if (contentType === 'meme') await deleteMedia(actor, contentId);
			else if (contentType === 'comment') await deleteComment(actor, contentId);
			else await deleteQuote(actor, contentId);
			await audit(
				actor.id,
				AUDIT_ACTIONS.contentDeleted,
				contentType,
				contentId,
				`${open.author}: ${open.excerpt}`
			);
			break;

		case 'timeout':
			await setTimeout_(actor, open.authorId, action.days, action.reason);
			break;
	}
	await resolveReports(actor, contentType, contentId, 'actioned');
}
