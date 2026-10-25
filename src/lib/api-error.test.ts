import { describe, expect, it } from 'vitest';
import { apiErrorMessage, BREAK_MESSAGE } from './api-error';

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

	it('says Loki is taking a break for a 503 without a usable body, whatever the fallback', async () => {
		expect(BREAK_MESSAGE).toBe('Loki is taking a break. Try again in a moment.');
		for (const fallback of ['fb', '']) {
			const html = new Response('<html><body>Loki is taking a break</body></html>', {
				status: 503,
				headers: { 'content-type': 'text/html' }
			});
			expect(await apiErrorMessage(html, fallback)).toBe(BREAK_MESSAGE);
			expect(await apiErrorMessage(new Response(null, { status: 503 }), fallback)).toBe(
				BREAK_MESSAGE
			);
			expect(await apiErrorMessage(json(503, { message: '' }), fallback)).toBe(BREAK_MESSAGE);
			expect(await apiErrorMessage(json(503, { error: 'x' }), fallback)).toBe(BREAK_MESSAGE);
		}
	});

	it('still falls back for a 403 without a usable body', async () => {
		expect(await apiErrorMessage(new Response('<html>', { status: 403 }), 'fb')).toBe('fb');
	});

	it('keeps other statuses technical', async () => {
		expect(await apiErrorMessage(json(500, { message: 'boom' }), 'fb')).toBe('fb');
		expect(await apiErrorMessage(json(429, { error: 'slow down' }), 'fb')).toBe('fb');
	});
});
