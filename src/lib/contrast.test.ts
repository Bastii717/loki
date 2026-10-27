import { describe, expect, it } from 'vitest';
import { composite, contrastRatio } from './contrast';

describe('contrastRatio', () => {
	it('is 21 for white on black', () => {
		expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
	});

	it('is 1 for identical colours', () => {
		expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
	});

	it('matches the known value for #767676 on white', () => {
		expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
	});

	it('is symmetric and accepts the short hex form', () => {
		expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 2);
		expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 2);
	});

	it('rejects malformed colours', () => {
		expect(() => contrastRatio('red', '#fff')).toThrow();
	});
});

describe('composite', () => {
	it('blends an rgba colour over a hex background', () => {
		expect(composite('rgba(255, 0, 0, 0.5)', '#000000')).toBe('#800000');
		expect(composite('rgba(0, 0, 0, 0.5)', '#ffffff')).toBe('#808080');
	});

	it('returns the background for a fully transparent colour', () => {
		expect(composite('rgba(10, 20, 30, 0)', '#112233')).toBe('#112233');
	});

	it('feeds into contrastRatio', () => {
		const soft = composite('rgba(88, 101, 242, 0.18)', '#2b2d31');
		expect(contrastRatio('#a5acf7', soft)).toBeGreaterThan(4.5);
	});
});
