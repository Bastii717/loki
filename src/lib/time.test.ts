import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

const now = Date.parse('2026-10-20T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

describe('relativeTime', () => {
	it('formats minutes, hours and days in English', () => {
		expect(relativeTime(ago(5_000), now)).toBe('just now');
		expect(relativeTime(ago(5 * 60_000), now)).toBe('5 min ago');
		expect(relativeTime(ago(2 * 3_600_000 + 1000), now)).toBe('2 h ago');
		expect(relativeTime(ago(3 * 86_400_000), now)).toBe('3 d ago');
	});

	it('falls back to a date after a week and never goes negative', () => {
		expect(relativeTime(ago(10 * 86_400_000), now)).toBe('10 Oct 2026');
		expect(relativeTime(ago(-60_000), now)).toBe('just now');
	});
});
