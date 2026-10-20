import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

const now = Date.parse('2026-10-20T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

describe('relativeTime', () => {
	it('formats minutes, hours and days in German', () => {
		expect(relativeTime(ago(5_000), now)).toBe('gerade eben');
		expect(relativeTime(ago(5 * 60_000), now)).toBe('vor 5 min');
		expect(relativeTime(ago(2 * 3_600_000 + 1000), now)).toBe('vor 2 h');
		expect(relativeTime(ago(3 * 86_400_000), now)).toBe('vor 3 d');
	});

	it('falls back to a date after a week and never goes negative', () => {
		expect(relativeTime(ago(10 * 86_400_000), now)).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/);
		expect(relativeTime(ago(-60_000), now)).toBe('gerade eben');
	});
});
