import { describe, expect, it } from 'vitest';
import { fromBerlinLocal, toBerlinLocal } from './berlin-time';

describe('Berlin local time', () => {
	it('converts summer time (UTC+2) in both directions', () => {
		expect(fromBerlinLocal('2026-07-01T12:00').toISOString()).toBe('2026-07-01T10:00:00.000Z');
		expect(toBerlinLocal(new Date('2026-07-01T10:00:00Z'))).toBe('2026-07-01T12:00');
	});

	it('converts winter time (UTC+1) in both directions', () => {
		expect(fromBerlinLocal('2026-12-01T12:00').toISOString()).toBe('2026-12-01T11:00:00.000Z');
		expect(toBerlinLocal(new Date('2026-12-01T11:00:00Z'))).toBe('2026-12-01T12:00');
	});

	it('crosses the date line around midnight', () => {
		expect(fromBerlinLocal('2026-07-01T00:30').toISOString()).toBe('2026-06-30T22:30:00.000Z');
		expect(toBerlinLocal(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01T00:30');
	});

	it('handles the clock changes', () => {
		// 2026-03-29: 02:00 becomes 03:00; 02:30 does not exist and lands an hour later
		expect(fromBerlinLocal('2026-03-29T01:30').toISOString()).toBe('2026-03-29T00:30:00.000Z');
		expect(fromBerlinLocal('2026-03-29T02:30').toISOString()).toBe('2026-03-29T01:30:00.000Z');
		expect(fromBerlinLocal('2026-03-29T03:30').toISOString()).toBe('2026-03-29T01:30:00.000Z');
		// 2026-10-25: 03:00 becomes 02:00; 02:30 happens twice and the first one is taken
		expect(fromBerlinLocal('2026-10-25T02:30').toISOString()).toBe('2026-10-25T00:30:00.000Z');
		expect(fromBerlinLocal('2026-10-25T03:30').toISOString()).toBe('2026-10-25T02:30:00.000Z');
	});

	it('round-trips', () => {
		for (const v of ['2026-01-15T08:05', '2026-06-15T23:59', '2026-10-25T01:00']) {
			expect(toBerlinLocal(fromBerlinLocal(v))).toBe(v);
		}
	});

	it('rejects anything that is not a valid local date and time', () => {
		for (const v of ['', 'tomorrow', '2026-07-01', '2026-07-01T12:00:00', '2026-02-30T10:00']) {
			expect(() => fromBerlinLocal(v)).toThrow(RangeError);
		}
	});
});
