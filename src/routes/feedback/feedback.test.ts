import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({
	enabled: true,
	send: vi.fn<(message: string, sender: unknown) => Promise<void>>()
}));
vi.mock('../../lib/server/mail', () => ({
	feedbackEnabled: () => mail.enabled,
	sendFeedbackMail: mail.send
}));

import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { timeOut, userWithSession } from '../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { actions, load } from './+page.server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
	mail.enabled = true;
	mail.send.mockReset();
	mail.send.mockResolvedValue(undefined);
});

type User = Awaited<ReturnType<typeof userWithSession>>['user'];
type Failure = { status: number; data: Record<string, unknown> };

/** Runs the action directly, the way the other form-action tests do. */
const send = (user: User, form: Record<string, string>) =>
	actions.default({
		locals: { user },
		request: new Request('https://loki.test/feedback', {
			method: 'POST',
			body: new URLSearchParams(form)
		})
	} as never) as Promise<unknown>;

describe('feedback load', () => {
	it('is a 404 when the feature is not configured', async () => {
		mail.enabled = false;
		const { user } = await userWithSession();
		await expect(load({ locals: { user } } as never)).rejects.toMatchObject({ status: 404 });
	});

	it('renders when configured', async () => {
		const { user } = await userWithSession();
		await expect(load({ locals: { user } } as never)).resolves.toBeDefined();
	});
});

describe('feedback action', () => {
	it('mails the message with the sender and reports success', async () => {
		const { user } = await userWithSession();
		expect(await send(user, { message: '  Great app  ' })).toEqual({ sent: true });
		expect(mail.send).toHaveBeenCalledTimes(1);
		expect(mail.send).toHaveBeenCalledWith('Great app', {
			username: user.username,
			displayName: user.displayName
		});
	});

	it('sends null as the sender when anonymous is ticked', async () => {
		const { user } = await userWithSession();
		await send(user, { message: 'Psst', anonymous: 'on' });
		expect(mail.send).toHaveBeenCalledWith('Psst', null);
	});

	it('rejects a whitespace-only message without sending', async () => {
		const { user } = await userWithSession();
		const result = (await send(user, { message: ' \n\t ' })) as Failure;
		expect(result.status).toBe(400);
		expect(mail.send).not.toHaveBeenCalled();
	});

	it('accepts 2000 characters and rejects 2001 without sending', async () => {
		const { user } = await userWithSession();
		await send(user, { message: 'a'.repeat(2000) });
		expect(mail.send).toHaveBeenCalledTimes(1);
		mail.send.mockClear();
		const result = (await send(user, { message: 'a'.repeat(2001) })) as Failure;
		expect(result.status).toBe(400);
		expect(result.data.message).toBe('a'.repeat(2001));
		expect(mail.send).not.toHaveBeenCalled();
	});

	it('keeps the message and the anonymous choice when the transport fails', async () => {
		mail.send.mockRejectedValue(new Error('smtp down'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { user } = await userWithSession();
		const result = (await send(user, { message: 'Keep me', anonymous: 'on' })) as Failure;
		expect(result.status).toBe(500);
		expect(result.data).toEqual({
			error: 'Could not send your feedback — try again later.',
			message: 'Keep me',
			anonymous: true
		});
		// anonymous means no name in the logs either
		expect(JSON.stringify(spy.mock.calls)).not.toContain(user.username);
		spy.mockRestore();
	});

	it('allows five sends an hour and answers the sixth with a 429 form', async () => {
		const { user } = await userWithSession();
		for (let i = 0; i < 5; i++) {
			expect(await send(user, { message: `m${i}` })).toEqual({ sent: true });
		}
		const result = (await send(user, { message: 'one too many' })) as Failure;
		expect(result.status).toBe(429);
		expect(result.data).toMatchObject({
			error: 'Slow down, Lord! Too many requests.',
			message: 'one too many'
		});
		expect(mail.send).toHaveBeenCalledTimes(5);
	});

	it('limits each member on their own', async () => {
		const { user } = await userWithSession();
		const { user: other } = await userWithSession();
		for (let i = 0; i < 5; i++) await send(user, { message: 'x' });
		expect(await send(other, { message: 'mine' })).toEqual({ sent: true });
	});

	it('is a 404 when the feature is not configured', async () => {
		mail.enabled = false;
		const { user } = await userWithSession();
		await expect(send(user, { message: 'hi' })).rejects.toMatchObject({ status: 404 });
		expect(mail.send).not.toHaveBeenCalled();
	});

	it('lets a member with an active timeout send', async () => {
		const { user } = await userWithSession();
		const other = await userWithSession('admin');
		await timeOut(user.id, other.user.id);
		expect(await send(user, { message: 'sorry' })).toEqual({ sent: true });
	});
});
