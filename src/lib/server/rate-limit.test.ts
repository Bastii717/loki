import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimit, resetRateLimits } from './rate-limit';

beforeEach(() => {
	vi.useFakeTimers();
	resetRateLimits();
});
afterEach(() => vi.useRealTimers());

describe('rateLimit', () => {
	it('allows `limit` calls then blocks', () => {
		for (let i = 0; i < 3; i++) expect(rateLimit('a', 3, 1000)).toBe(true);
		expect(rateLimit('a', 3, 1000)).toBe(false);
	});

	it('tracks keys independently', () => {
		expect(rateLimit('a', 1, 1000)).toBe(true);
		expect(rateLimit('a', 1, 1000)).toBe(false);
		expect(rateLimit('b', 1, 1000)).toBe(true);
	});

	it('slides: old calls fall out of the window', () => {
		expect(rateLimit('a', 2, 1000)).toBe(true);
		vi.advanceTimersByTime(600);
		expect(rateLimit('a', 2, 1000)).toBe(true);
		expect(rateLimit('a', 2, 1000)).toBe(false);
		vi.advanceTimersByTime(500); // first call is now 1100ms old
		expect(rateLimit('a', 2, 1000)).toBe(true);
		expect(rateLimit('a', 2, 1000)).toBe(false);
	});

	it('does not count blocked calls against the window', () => {
		expect(rateLimit('a', 1, 1000)).toBe(true);
		vi.advanceTimersByTime(500);
		expect(rateLimit('a', 1, 1000)).toBe(false);
		vi.advanceTimersByTime(600);
		expect(rateLimit('a', 1, 1000)).toBe(true);
	});
});
