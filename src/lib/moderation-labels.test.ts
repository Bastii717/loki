import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './moderation-labels';

describe('date formatters', () => {
	const instant = '2026-10-24T12:05:00Z';

	it('formats date and time in Europe/Berlin, English', () => {
		expect(formatDateTime(instant)).toBe('24 Oct 2026, 14:05');
	});

	it('formats the date alone', () => {
		expect(formatDate(instant)).toBe('24 Oct 2026');
	});
});
