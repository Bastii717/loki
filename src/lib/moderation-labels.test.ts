import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, modName } from './moderation-labels';

describe('date formatters', () => {
	const instant = '2026-10-24T12:05:00Z';

	it('formats date and time in Europe/Berlin, English', () => {
		expect(formatDateTime(instant)).toBe('24 Oct 2026, 14:05');
	});

	it('formats the date alone', () => {
		expect(formatDate(instant)).toBe('24 Oct 2026');
	});
});

describe('modName', () => {
	it('shows the username next to a differing display name', () => {
		expect(modName('Rönja', 'mira')).toBe('Rönja (mira)');
	});

	it('shows the username alone without a display name or when both are equal', () => {
		expect(modName('mira', 'mira')).toBe('mira');
		expect(modName('', 'mira')).toBe('mira');
		expect(modName(null, 'mira')).toBe('mira');
	});
});
