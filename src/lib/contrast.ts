/** WCAG 2.x contrast helpers. Used by the unit tests and by scripts/check-contrast.ts. */

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) throw new Error(`Not a hex colour: ${hex}`);
	let digits = match[1];
	if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
	return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
	return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function channel(value: number): number {
	const s = value / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const [r, g, b] = parseHex(hex);
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colours (`#rgb` or `#rrggbb`), from 1 to 21. */
export function contrastRatio(hexA: string, hexB: string): number {
	const a = luminance(hexA);
	const b = luminance(hexB);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Flattens `rgba(r, g, b, a)` over an opaque hex background and returns the result as `#rrggbb`. */
export function composite(rgba: string, overHex: string): string {
	const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(rgba.trim());
	if (!match) throw new Error(`Not an rgba colour: ${rgba}`);
	const fg: Rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
	const alpha = Number(match[4]);
	const bg = parseHex(overHex);
	return toHex(fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb);
}
