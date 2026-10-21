import type { SessionUser } from './auth/session';
import { CommentNotFoundError, deleteComment } from './comments';
import { deleteMedia, setFlags } from './memes';
import { resolveAfterDelete, resolveReports, setTimeout_, type ContentType } from './moderation';
import { getOpenCase } from './moderation-queries';
import { deleteQuote, QuoteNotFoundError } from './quotes';
import { MediaNotFoundError } from './votes';

export type CaseErrorCode = 'notfound' | 'invalid' | 'own';

/** 'notfound' = the content has no open reports (anymore); 'invalid' = action does not fit the content;
 * 'own' = the actor is the author and may not decide on reports against themselves. */
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

const isContentGone = (e: unknown) =>
	e instanceof MediaNotFoundError ||
	e instanceof CommentNotFoundError ||
	e instanceof QuoteNotFoundError;

/**
 * Queue actions on one case. The CALLER must have verified the actor's moderator role and that
 * the actor is not timed out (requireModerator); the underlying modules trust `actor`.
 *
 * Every action requires an open case (a double click or a second moderator gets 'notfound').
 * The content modules close the reports and write the audit row for their own mutation, exactly
 * as for an inline moderator action outside the queue (resolveWithAudit / resolveAfterDelete),
 * so both paths behave identically:
 * - release: resolveReports 'dismissed' (stamps reviewedAt, audits report_dismissed itself);
 *            0 closed reports means another moderator was faster: 'notfound'
 * - flags:   setFlags nsfw (memes only): flags_forced + 'actioned'
 * - delete:  deleteMedia/Comment/Quote: content_deleted + 'actioned'. Content that is already gone
 *            (an earlier attempt half-completed) is not an error: the case is still closed and audited.
 * - timeout: setTimeout_ on the author (audits timeout_set itself), then 'actioned'
 * Self-dealing guard: on a case about the actor's OWN content, release and flags are refused
 * ('own'): nobody dismisses reports against themselves or earns auto-hide immunity that way.
 * Deleting one's own content stays allowed and closes the reports as 'removed' (the author's
 * own act, not a moderation decision; no audit row, like any own-delete). Timeout on oneself is
 * refused by setTimeout_.
 * The mutation comes first so a failed one (permission, timeout rules) leaves the case open.
 */
export async function actOnCase(
	actor: SessionUser,
	contentType: ContentType,
	contentId: number,
	action: CaseAction
): Promise<void> {
	const open = await getOpenCase(contentType, contentId);
	if (!open) throw new CaseError('notfound');
	const own = open.authorId === actor.id;
	if (own && (action.type === 'release' || action.type === 'flags')) throw new CaseError('own');

	switch (action.type) {
		case 'release':
			if ((await resolveReports(actor, contentType, contentId, 'dismissed')) === 0) {
				throw new CaseError('notfound');
			}
			return;

		case 'flags':
			if (contentType !== 'meme') throw new CaseError('invalid');
			await setFlags(actor, contentId, { nsfw: true });
			return;

		case 'delete':
			try {
				if (contentType === 'meme') await deleteMedia(actor, contentId);
				else if (contentType === 'comment') await deleteComment(actor, contentId);
				else await deleteQuote(actor, contentId);
			} catch (e) {
				if (!isContentGone(e)) throw e;
				await resolveAfterDelete(actor, contentType, contentId, open.authorId);
			}
			return;

		case 'timeout':
			await setTimeout_(actor, open.authorId, action.days, action.reason);
			await resolveReports(actor, contentType, contentId, 'actioned');
			return;
	}
}
