import type { SeasonId } from './seasons';

/** The animated decoration a season draws behind the page header. */
export type EffectKind = 'snow' | 'bats' | 'confetti' | 'sparkles';

export const EFFECT_BY_SEASON: Record<SeasonId, EffectKind> = {
	halloween: 'bats',
	advent: 'snow',
	carnival: 'confetti',
	party: 'sparkles'
};

/** Kept small on purpose: the header is a strip, not a snow globe. */
export const PARTICLE_COUNTS: Record<EffectKind, number> = {
	snow: 18,
	bats: 5,
	confetti: 22,
	sparkles: 12
};

export interface Particle {
	/** Start position across the header, in percent (bats start just outside it). */
	left: number;
	/** Base size in px; each kind derives its shape from it. */
	size: number;
	/** Seconds; negative, so every particle is already in flight on load. */
	delay: number;
	/** Seconds for one pass. */
	duration: number;
	/** Sideways travel: px for falling kinds, vw for bats (negative = leftwards). */
	drift: number;
	/** Degrees of rotation over one pass (confetti and sparkles). */
	spin: number;
	/** Resting height in percent when motion is reduced; the flight height for bats. */
	rest: number;
	/** Fixed colour for confetti and sparkles; '' where the theme decides (snow, bats). */
	color: string;
}

const PALETTES: Partial<Record<EffectKind, readonly string[]>> = {
	confetti: ['#e0448a', '#f0b232', '#3fb8f0', '#58d68d', '#a86bf0'],
	sparkles: ['#f3c969', '#fff3c4', '#f0b232']
};

/** [min, max] seconds per pass. */
const SPEEDS: Record<EffectKind, [number, number]> = {
	snow: [4, 8],
	bats: [7, 11],
	confetti: [2.5, 4.5],
	sparkles: [4, 7]
};

/** Small seeded PRNG (mulberry32): the same particles on the server and in the browser. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const round = (n: number, digits = 1) => Number(n.toFixed(digits));

function build(kind: EffectKind): Particle[] {
	const rnd = prng([...kind].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
	const count = PARTICLE_COUNTS[kind];
	const palette = PALETTES[kind];
	const [lo, hi] = SPEEDS[kind];
	return Array.from({ length: count }, (_, i) => {
		const duration = round(lo + rnd() * (hi - lo));
		const delay = round(-rnd() * duration * 0.95);
		const size = round(2 + rnd() * 3.5);
		const color = palette ? palette[Math.floor(rnd() * palette.length)] : '';
		if (kind === 'bats') {
			// alternate directions so both sides are used, whatever the PRNG does
			const rightwards = i % 2 === 0;
			return {
				left: rightwards ? -8 : 104,
				size,
				delay,
				duration,
				drift: (rightwards ? 1 : -1) * round(110 + rnd() * 20, 0),
				spin: 0,
				rest: round(10 + rnd() * 60, 0),
				color
			};
		}
		return {
			// one slot per particle, jittered inside it, so the strip is evenly covered
			left: round(((i + rnd()) / count) * 100),
			size,
			delay,
			duration,
			drift: round(rnd() * 30 - 15, 0),
			spin: kind === 'snow' ? 0 : round(rnd() * 720 - 360, 0),
			rest: round(rnd() * 90, 0),
			color
		};
	});
}

const cache = new Map<EffectKind, Particle[]>();

/** The particles of an effect; computed once per kind and shared. */
export function particlesFor(kind: EffectKind): Particle[] {
	let ps = cache.get(kind);
	if (!ps) {
		ps = build(kind);
		cache.set(kind, ps);
	}
	return ps;
}
