import { describe, expect, it } from 'vitest';
import { reportRequest } from './report-request';

describe('reportRequest', () => {
	it('posts JSON to /api/report with the public id as contentId', () => {
		const [url, init] = reportRequest({
			contentType: 'comment',
			contentId: 'AbCdEfGh1234',
			category: 'spam',
			text: 'why'
		});
		expect(url).toBe('/api/report');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({
			contentType: 'comment',
			contentId: 'AbCdEfGh1234',
			category: 'spam',
			text: 'why'
		});
	});
});
