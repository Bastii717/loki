import { error } from '@sveltejs/kit';
import { CommentNotFoundError, CommentPermissionError } from '../../../../lib/server/comments';
import { MediaPermissionError } from '../../../../lib/server/memes';
import {
	MAX_TIMEOUT_DAYS,
	MAX_TIMEOUT_REASON,
	type ContentType
} from '../../../../lib/server/moderation';
import { actOnCase, CaseError, type CaseAction } from '../../../../lib/server/moderation-cases';
import { requireModerator } from '../../../../lib/server/moderation-guard';
import { mapTimeoutActionError } from '../../../../lib/server/moderation-http';
import { QuoteNotFoundError, QuotePermissionError } from '../../../../lib/server/quotes';
import { MediaNotFoundError } from '../../../../lib/server/votes';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: readonly ContentType[] = ['meme', 'comment', 'quote'];

function parseAction(body: Record<string, unknown>): CaseAction {
	switch (body.action) {
		case 'release':
		case 'flags':
		case 'delete':
			return { type: body.action };
		case 'timeout': {
			const { days, reason } = body;
			if (
				typeof days !== 'number' ||
				!Number.isInteger(days) ||
				days < 1 ||
				days > MAX_TIMEOUT_DAYS
			) {
				error(400, `Bitte 1 bis ${MAX_TIMEOUT_DAYS} Tage angeben.`);
			}
			if (
				typeof reason !== 'string' ||
				reason.trim() === '' ||
				reason.length > MAX_TIMEOUT_REASON
			) {
				error(400, `Bitte einen Grund (höchstens ${MAX_TIMEOUT_REASON} Zeichen) angeben.`);
			}
			return { type: 'timeout', days, reason };
		}
		default:
			error(400, 'Unbekannte Aktion.');
	}
}

/**
 * Queue action on one case: release, force NSFW blur, delete the content or time out its author.
 * Role and timeout gate first (requireModerator); the body is validated at runtime before any module runs.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const actor = await requireModerator(locals.user);

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, 'Ungültige Anfrage.');
	}
	const body = (raw ?? {}) as Record<string, unknown>;
	const { contentType, contentId } = body;
	if (typeof contentType !== 'string' || !CONTENT_TYPES.includes(contentType as ContentType)) {
		error(400, 'Ungültiger Inhaltstyp.');
	}
	if (typeof contentId !== 'number' || !Number.isSafeInteger(contentId) || contentId <= 0) {
		error(400, 'Ungültige Inhalts-ID.');
	}
	const action = parseAction(body);

	try {
		await actOnCase(actor, contentType as ContentType, contentId, action);
	} catch (e) {
		if (e instanceof CaseError && e.code === 'own') {
			error(403, 'Über Meldungen zu eigenen Inhalten entscheidet ein anderes Teammitglied.');
		}
		if (e instanceof CaseError) {
			error(
				e.code === 'notfound' ? 404 : 400,
				e.code === 'notfound'
					? 'Dieser Fall ist bereits erledigt.'
					: 'Diese Aktion passt nicht zu diesem Inhalt.'
			);
		}
		if (
			e instanceof MediaNotFoundError ||
			e instanceof CommentNotFoundError ||
			e instanceof QuoteNotFoundError
		) {
			error(404, 'Der Inhalt existiert nicht mehr. Du kannst den Fall freigeben.');
		}
		if (
			e instanceof MediaPermissionError ||
			e instanceof CommentPermissionError ||
			e instanceof QuotePermissionError
		) {
			error(403, 'Dazu fehlt dir die Berechtigung.');
		}
		mapTimeoutActionError(e);
	}
	return new Response(null, { status: 204 });
};
