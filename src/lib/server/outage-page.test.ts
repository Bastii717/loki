import { describe, expect, it } from 'vitest';
import { outagePage } from './outage-page';

describe('outagePage', () => {
	it('is a 503 HTML page that retries on its own', async () => {
		const res = outagePage();
		expect(res.status).toBe(503);
		expect(res.headers.get('content-type')).toMatch(/^text\/html/);
		expect(res.headers.get('retry-after')).toBe('30');
		const body = await res.text();
		expect(body).toContain('Loki is taking a break');
		expect(body).toContain('http-equiv="refresh"');
	});
});
