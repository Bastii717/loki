import nodemailer from 'nodemailer';
import { env } from './env';

interface Transport {
	sendMail(opts: object): Promise<unknown>;
}

let transport: Transport | null = null;

/** Test seam: swap the SMTP transport for a fake (or `null` to go back to the real one). */
export function setMailTransportForTests(t: Transport | null): void {
	transport = t;
}

/** Feedback is on when SMTP_HOST, MAIL_FROM and FEEDBACK_TO are all configured (env.ts enforces all-or-none). */
export function feedbackEnabled(): boolean {
	return env.SMTP_HOST !== null && env.MAIL_FROM !== null && env.FEEDBACK_TO.length > 0;
}

function getTransport(): Transport {
	transport ??= nodemailer.createTransport({
		host: env.SMTP_HOST!,
		port: env.SMTP_PORT,
		secure: env.SMTP_SECURE,
		// without this nodemailer silently falls back to cleartext when STARTTLS is not offered
		...(env.SMTP_SECURE ? {} : { requireTLS: env.SMTP_REQUIRE_TLS }),
		// an unreachable host must not hold the request for minutes
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 15_000,
		auth: env.SMTP_USER === '' ? undefined : { user: env.SMTP_USER, pass: env.SMTP_PASS }
	});
	return transport;
}

// everything below space except tab and newline, plus DEL (carriage returns are dropped too)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_INLINE = /[\u0000-\u001f\u007f]/g;

/**
 * Mails a member's feedback to the admins. Plain text only; the subject is constant so no user
 * input ever reaches a header. `sender === null` sends anonymously: no name appears anywhere.
 */
export async function sendFeedbackMail(
	message: string,
	sender: { username: string; displayName: string | null } | null
): Promise<void> {
	if (!feedbackEnabled()) throw new Error('Feedback mail is not configured');
	const signature = sender
		? sender.displayName
			? `— ${sender.displayName.replace(CONTROL_INLINE, '')} (${sender.username.replace(CONTROL_INLINE, '')})`
			: `— ${sender.username.replace(CONTROL_INLINE, '')}`
		: '— sent anonymously';
	await getTransport().sendMail({
		from: env.MAIL_FROM,
		to: env.FEEDBACK_TO,
		subject: sender ? 'Loki feedback' : 'Loki feedback (anonymous)',
		text: `${message.replace(CONTROL, '')}\n\n${signature}`
	});
}
