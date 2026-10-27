import { describe, expect, it } from 'vitest';
import { berlinDate, easterSunday, seasonForDate } from './season-dates';

const at = (iso: string) => new Date(iso);

describe('easterSunday', () => {
	it('computes the Gregorian Easter date', () => {
		expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
		expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
		expect(easterSunday(2024)).toEqual({ month: 3, day: 31 });
	});
});

describe('berlinDate', () => {
	it('reads the calendar date in Berlin, not UTC', () => {
		expect(berlinDate(at('2026-10-24T22:00:00Z'))).toEqual({ year: 2026, month: 10, day: 25 });
		expect(berlinDate(at('2026-12-31T23:30:00Z'))).toEqual({ year: 2027, month: 1, day: 1 });
	});
});

describe('seasonForDate', () => {
	it('starts Halloween at midnight Berlin time on Oct 25 (CEST)', () => {
		expect(seasonForDate(at('2026-10-24T21:59:59Z'))).toBeNull();
		expect(seasonForDate(at('2026-10-24T22:00:00Z'))).toBe('halloween');
	});

	it('ends Halloween after Nov 1 (CET)', () => {
		expect(seasonForDate(at('2026-11-01T22:59:59Z'))).toBe('halloween');
		expect(seasonForDate(at('2026-11-01T23:00:00Z'))).toBeNull();
	});

	it('runs Advent from Dec 1 to Dec 26', () => {
		expect(seasonForDate(at('2026-11-30T22:59:59Z'))).toBeNull();
		expect(seasonForDate(at('2026-11-30T23:00:00Z'))).toBe('advent');
		expect(seasonForDate(at('2026-12-26T22:59:59Z'))).toBe('advent');
		expect(seasonForDate(at('2026-12-26T23:00:00Z'))).toBeNull();
	});

	it('runs Carnival 2026 from Feb 12 to Feb 18', () => {
		expect(seasonForDate(at('2026-02-11T12:00:00Z'))).toBeNull();
		expect(seasonForDate(at('2026-02-12T12:00:00Z'))).toBe('carnival');
		expect(seasonForDate(at('2026-02-18T12:00:00Z'))).toBe('carnival');
		expect(seasonForDate(at('2026-02-19T12:00:00Z'))).toBeNull();
	});

	it('runs Carnival 2027 from Feb 4 to Feb 10', () => {
		expect(seasonForDate(at('2027-02-03T12:00:00Z'))).toBeNull();
		expect(seasonForDate(at('2027-02-04T12:00:00Z'))).toBe('carnival');
		expect(seasonForDate(at('2027-02-10T12:00:00Z'))).toBe('carnival');
		expect(seasonForDate(at('2027-02-11T12:00:00Z'))).toBeNull();
	});

	it('is null in an ordinary week', () => {
		expect(seasonForDate(at('2026-06-15T12:00:00Z'))).toBeNull();
	});

	it('never returns party', () => {
		for (let day = 0; day < 366; day++) {
			const instant = new Date(Date.UTC(2026, 0, 1 + day, 12));
			expect(seasonForDate(instant)).not.toBe('party');
		}
	});
});
