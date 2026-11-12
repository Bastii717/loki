import { error, fail } from '@sveltejs/kit';
import { feedbackEnabled, sendFeedbackMail } from '../../lib/server/mail';
import { rateLimit } from '../../lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

const MAX_LENGTH = 2000;
const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

/** The page only exists when the admin mailbox is configured. */
export const load: PageServerLoad = async () => {
	if (!feedbackEnabled()) error(404, 'Not found');
	return { maxLength: MAX_LENGTH };
};

export const actions: Actions = {
	// Open to members with an active timeout too: it is how they reach the admins, not a post.
	default: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		if (!feedbackEnabled()) error(404, 'Not found');
		const form = await request.formData();
		const raw = form.get('message');
		const message = typeof raw === 'string' ? raw : '';
		const anonymous = form.get('anonymous') === 'on';
		// echoed back on every failure so the form keeps what was typed
		const echo = { message, anonymous };
		const text = message.trim();
		if (text === '') return fail(400, { error: 'Please write a message first.', ...echo });
		if (text.length > MAX_LENGTH) {
			return fail(400, { error: `Please keep it under ${MAX_LENGTH} characters.`, ...echo });
		}
		if (!rateLimit(`feedback:${locals.user.id}`, LIMIT, WINDOW_MS)) {
			return fail(429, { error: 'Slow down, Lord! Too many requests.', ...echo });
		}
		try {
			await sendFeedbackMail(
				text,
				anonymous ? null : { username: locals.user.username, displayName: locals.user.displayName }
			);
		} catch (err) {
			// never log who was sending: anonymous means anonymous
			console.error('feedback mail failed:', err instanceof Error ? err.message : 'unknown error');
			return fail(500, { error: 'Could not send your feedback — try again later.', ...echo });
		}
		return { sent: true };
	}
};
