import { describe, expect, it } from 'vitest';
import { EFFECT_BY_SEASON, PARTICLE_COUNTS, particlesFor, type EffectKind } from './season-effects';
import { SEASONS } from './seasons';

const KINDS: EffectKind[] = ['snow', 'bats', 'confetti', 'sparkles'];

describe('season effects', () => {
	it('gives every season an effect: snow, bats, confetti and sparkles', () => {
		expect(SEASONS.map((s) => [s.id, EFFECT_BY_SEASON[s.id]])).toEqual([
			['halloween', 'bats'],
			['advent', 'snow'],
			['carnival', 'confetti'],
			['party', 'sparkles']
		]);
	});

	it('keeps the header light: a handful of bats, about twenty flakes or confetti strips', () => {
		expect(PARTICLE_COUNTS).toEqual({ snow: 18, bats: 5, confetti: 22, sparkles: 12 });
		for (const kind of KINDS) expect(particlesFor(kind)).toHaveLength(PARTICLE_COUNTS[kind]);
	});

	it('is deterministic, so the server render and the hydrated page agree', () => {
		for (const kind of KINDS) expect(particlesFor(kind)).toEqual(particlesFor(kind));
	});

	it('spreads falling particles across the width and starts them mid-flight', () => {
		for (const kind of ['snow', 'confetti', 'sparkles'] as const) {
			const ps = particlesFor(kind);
			for (const p of ps) {
				expect(p.left).toBeGreaterThanOrEqual(0);
				expect(p.left).toBeLessThan(100);
				expect(p.duration).toBeGreaterThan(0);
				// a negative delay starts the animation part-way, so nothing waits off-screen on load
				expect(p.delay).toBeLessThanOrEqual(0);
				expect(p.delay).toBeGreaterThan(-p.duration);
				expect(Math.abs(p.drift)).toBeLessThanOrEqual(15);
			}
			// not all bunched on one side
			expect(Math.min(...ps.map((p) => p.left))).toBeLessThan(25);
			expect(Math.max(...ps.map((p) => p.left))).toBeGreaterThan(75);
		}
	});

	it('lets bats cross the header from either side, at different heights', () => {
		const bats = particlesFor('bats');
		for (const b of bats) {
			// off-screen start: left of the header flying right, or right of it flying left
			if (b.drift > 0) expect(b.left).toBeLessThan(0);
			else expect(b.left).toBeGreaterThan(100);
			expect(Math.abs(b.drift)).toBeGreaterThanOrEqual(100);
			expect(b.rest).toBeGreaterThanOrEqual(10);
			expect(b.rest).toBeLessThanOrEqual(70);
		}
		expect(bats.some((b) => b.drift > 0)).toBe(true);
		expect(bats.some((b) => b.drift < 0)).toBe(true);
	});

	it('colours confetti and sparkles from fixed palettes and leaves snow and bats to the theme', () => {
		expect(new Set(particlesFor('confetti').map((p) => p.color)).size).toBeGreaterThan(2);
		for (const p of particlesFor('sparkles')) expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
		for (const p of particlesFor('snow')) expect(p.color).toBe('');
		for (const p of particlesFor('bats')) expect(p.color).toBe('');
	});
});
