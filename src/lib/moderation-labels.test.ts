import { describe, expect, it } from 'vitest';
import {
	formatDate,
	formatDateTime,
	formatMonthLong,
	formatMonthYear,
	modName
} from './moderation-labels';

describe('date formatters', () => {
	const instant = '2026-10-24T12:05:00Z';

	it('formats date and time in Europe/Berlin, English', () => {
		expect(formatDateTime(instant)).toBe('24 Oct 2026, 14:05');
	});

	it('formats the date alone', () => {
		expect(formatDate(instant)).toBe('24 Oct 2026');
	});

	it('formats month and year, in Berlin time', () => {
		expect(formatMonthYear(instant)).toBe('Oct 2026');
		// 23:30 UTC on 31 Oct is already 1 Nov in Berlin
		expect(formatMonthYear('2026-10-31T23:30:00Z')).toBe('Nov 2026');
	});

	it('abbreviates September as Sep', () => {
		expect(formatMonthYear('2026-09-15T12:00:00Z')).toBe('Sep 2026');
	});

	it('accepts a YYYY-MM month for the short form', () => {
		expect(formatMonthYear('2026-10')).toBe('Oct 2026');
		expect(formatMonthYear('2026-09')).toBe('Sep 2026');
	});

	it('writes the month out in full, from YYYY-MM or an ISO date', () => {
		expect(formatMonthLong('2026-10')).toBe('October 2026');
		expect(formatMonthLong('2027-01')).toBe('January 2027');
		expect(formatMonthLong('2026-09-15T12:00:00Z')).toBe('September 2026');
		// 23:30 UTC on 31 Oct is already 1 Nov in Berlin
		expect(formatMonthLong('2026-10-31T23:30:00Z')).toBe('November 2026');
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
