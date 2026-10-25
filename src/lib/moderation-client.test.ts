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

	it('falls back for a 503 without a JSON body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(new Response('down', { status: 503 })))
		);
		expect(await modRequest('/api/moderation/x', 'POST', undefined, 'fb')).toEqual({
			ok: false,
			message: 'fb'
		});
	});
});
