import { describe, expect, it } from 'vitest';
import { SEASONS, seasonById } from './seasons';

describe('SEASONS', () => {
	it('lists halloween, advent, carnival and party', () => {
		expect(SEASONS.map((s) => s.id)).toEqual(['halloween', 'advent', 'carnival', 'party']);
	});

	it('gives every season a label, an icon and a tagline without emoji', () => {
		for (const season of SEASONS) {
			expect(season.label.length).toBeGreaterThan(0);
			expect(season.icon.length).toBeGreaterThan(0);
			expect(season.tagline.trim().length).toBeGreaterThan(0);
			expect(season.tagline).not.toMatch(/\p{Extended_Pictographic}/u);
		}
	});
});

describe('seasonById', () => {
	it('finds a season by id', () => {
		expect(seasonById('advent')?.id).toBe('advent');
		expect(seasonById('party')?.icon).toBe('sparkles');
	});

	it('returns undefined for an unknown id', () => {
		expect(seasonById('nope')).toBeUndefined();
	});
});
