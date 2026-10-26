import { describe, expect, it } from 'vitest';
import { nextRefreshDelay } from './status-refresh';

const NOW = Date.parse('2026-10-24T16:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('nextRefreshDelay', () => {
	it('does not poll while everything is ok', () => {
		expect(nextRefreshDelay({ state: 'ok', nextChangeAt: null }, NOW)).toBeNull();
		expect(nextRefreshDelay({ state: 'ok', nextChangeAt: iso(5_000) }, NOW)).toBeNull();
	});

	it('polls every minute without a known change', () => {
		for (const state of ['announced', 'maintenance', 'not_ready', 'down']) {
			expect(nextRefreshDelay({ state, nextChangeAt: null }, NOW)).toBe(60_000);
		}
	});

	it('wakes one second after a change that is closer than a minute', () => {
		expect(nextRefreshDelay({ state: 'maintenance', nextChangeAt: iso(10_000) }, NOW)).toBe(11_000);
	});

	it('caps a distant change at a minute', () => {
		expect(nextRefreshDelay({ state: 'announced', nextChangeAt: iso(3_600_000) }, NOW)).toBe(
			60_000
		);
	});

	it('never goes below one second, even for a change in the past', () => {
		expect(nextRefreshDelay({ state: 'maintenance', nextChangeAt: iso(-30_000) }, NOW)).toBe(1_000);
		expect(nextRefreshDelay({ state: 'maintenance', nextChangeAt: iso(-1_000) }, NOW)).toBe(1_000);
		expect(nextRefreshDelay({ state: 'maintenance', nextChangeAt: iso(0) }, NOW)).toBe(1_000);
	});

	it('falls back to a minute for an unparsable instant', () => {
		expect(nextRefreshDelay({ state: 'maintenance', nextChangeAt: 'nope' }, NOW)).toBe(60_000);
	});
});
