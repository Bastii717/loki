import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
	SMTP_HOST: 'smtp.example.test' as string | null,
	SMTP_PORT: 587,
	SMTP_SECURE: false,
	SMTP_USER: '',
	SMTP_PASS: '',
	MAIL_FROM: 'loki@example.test' as string | null,
	FEEDBACK_TO: ['admin@example.test', 'second@example.test'] as string[]
}));
vi.mock('./env', () => ({ env: fakeEnv }));

import { feedbackEnabled, sendFeedbackMail, setMailTransportForTests } from './mail';

const sent: Record<string, unknown>[] = [];

beforeEach(() => {
	sent.length = 0;
	fakeEnv.SMTP_HOST = 'smtp.example.test';
	fakeEnv.MAIL_FROM = 'loki@example.test';
	fakeEnv.FEEDBACK_TO = ['admin@example.test', 'second@example.test'];
	setMailTransportForTests({
		sendMail: async (opts) => {
			sent.push(opts as Record<string, unknown>);
			return {};
		}
	});
});

describe('feedbackEnabled', () => {
	it('is true when host, sender and recipients are configured', () => {
		expect(feedbackEnabled()).toBe(true);
	});

	it.each([
		['SMTP_HOST', null],
		['MAIL_FROM', null],
		['FEEDBACK_TO', []]
	])('is false when %s is missing', (name, value) => {
		(fakeEnv as Record<string, unknown>)[name] = value;
		expect(feedbackEnabled()).toBe(false);
	});
});

describe('sendFeedbackMail', () => {
	it('sends a text-only mail with a constant subject, signed with the sender', async () => {
		await sendFeedbackMail('Great app', { username: 'noah', displayName: 'Noah' });
		expect(sent).toHaveLength(1);
		const mail = sent[0];
		expect(mail.from).toBe('loki@example.test');
		expect(mail.to).toEqual(['admin@example.test', 'second@example.test']);
		expect(mail.subject).toBe('Loki feedback');
		expect(mail).not.toHaveProperty('html');
		expect(String(mail.text)).toContain('Great app');
		expect(String(mail.text).endsWith('— Noah (noah)')).toBe(true);
	});

	it('falls back to the username when there is no display name', async () => {
		await sendFeedbackMail('Hi', { username: 'noah', displayName: null });
		expect(String(sent[0].text).endsWith('— noah')).toBe(true);
	});

	it('sends anonymously without any trace of the sender', async () => {
		await sendFeedbackMail('Secret idea', null);
		const mail = sent[0];
		expect(mail.subject).toBe('Loki feedback (anonymous)');
		expect(String(mail.text).endsWith('— sent anonymously')).toBe(true);
		expect(JSON.stringify(mail)).not.toMatch(/noah/i);
	});

	it('strips control characters except newline and tab, also from the signature', async () => {
		await sendFeedbackMail('a\u0000b\u0007c\r\nd\te\u001b[31m', {
			username: 'noah',
			displayName: 'No\nah\u0000'
		});
		const text = String(sent[0].text);
		expect(text).toContain('abc\nd\te[31m');
		// eslint-disable-next-line no-control-regex
		expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
		expect(text.endsWith('— Noah (noah)')).toBe(true);
	});

	it('refuses to send when the feature is not configured', async () => {
		fakeEnv.SMTP_HOST = null;
		await expect(sendFeedbackMail('x', null)).rejects.toThrow();
		expect(sent).toHaveLength(0);
	});

	it('propagates transport failures', async () => {
		setMailTransportForTests({
			sendMail: async () => {
				throw new Error('smtp down');
			}
		});
		await expect(sendFeedbackMail('x', null)).rejects.toThrow('smtp down');
	});
});
