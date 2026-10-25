import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './api-error';

const json = (status: number, body: unknown) => Response.json(body, { status });

describe('apiErrorMessage', () => {
	it('reads the message of a 403', async () => {
		expect(await apiErrorMessage(json(403, { message: 'You are muted.' }), 'fb')).toBe(
			'You are muted.'
		);
	});

	it('reads the message of a 503', async () => {
		expect(await apiErrorMessage(json(503, { message: 'x' }), 'fb')).toBe('x');
	});

	it('falls back for a 503 without a usable body', async () => {
		expect(await apiErrorMessage(new Response(null, { status: 503 }), 'fb')).toBe('fb');
		expect(await apiErrorMessage(new Response('<html>', { status: 503 }), 'fb')).toBe('fb');
		expect(await apiErrorMessage(json(503, { message: '' }), 'fb')).toBe('fb');
		expect(await apiErrorMessage(json(503, { error: 'x' }), 'fb')).toBe('fb');
	});

	it('keeps other statuses technical', async () => {
		expect(await apiErrorMessage(json(500, { message: 'boom' }), 'fb')).toBe('fb');
		expect(await apiErrorMessage(json(429, { error: 'slow down' }), 'fb')).toBe('fb');
	});
});
