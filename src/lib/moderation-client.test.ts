import { afterEach, describe, expect, it, vi } from 'vitest';
import { modRequest } from './moderation-client';

afterEach(() => vi.unstubAllGlobals());

describe('modRequest', () => {
	it('shows the message of a 503 write lock', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(Response.json({ message: 'Paused.' }, { status: 503 })))
		);
		expect(await modRequest('/api/moderation/x', 'POST')).toEqual({
			ok: false,
			message: 'Paused.'
		});
	});

	it('says Loki is taking a break for a 503 without a JSON body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(new Response('<html>down</html>', { status: 503 })))
		);
		expect(await modRequest('/api/moderation/x', 'POST', undefined, 'fb')).toEqual({
			ok: false,
			message: 'Loki is taking a break. Try again in a moment.'
		});
	});

	it('keeps the fallback for other statuses without a JSON body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(new Response('boom', { status: 500 })))
		);
		expect(await modRequest('/api/moderation/x', 'POST', undefined, 'fb')).toEqual({
			ok: false,
			message: 'fb'
		});
	});
});
