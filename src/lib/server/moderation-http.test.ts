import { describe, expect, it } from 'vitest';
import { TimeoutActiveError } from './moderation';
import { timeoutMessage } from './moderation-http';

describe('timeoutMessage', () => {
	it('names the end date and the reason in English', () => {
		const e = new TimeoutActiveError(new Date('2026-10-24T10:00:00Z'), 'Spam');
		expect(timeoutMessage(e)).toBe('You are muted until 24 Oct 2026: Spam');
	});
});
