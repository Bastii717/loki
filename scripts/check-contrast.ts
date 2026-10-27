/**
 * Checks that every palette in src/app.css stays readable: each seasonal token layer (dark and
 * light) is enforced, the base dark and light palettes are listed for reference only (they predate
 * the seasons, a miss there is a warning). Prints a table and exits 1 on any failing season pair.
 *
 *   npx tsx scripts/check-contrast.ts
 *
 * The CSS is read with a simple regex per selector block, so keep the season blocks in the shape
 * `:root[data-season='x'] { --token: value; }` (see the comment above them in app.css).
 */
import { readFileSync } from 'node:fs';
import { composite, contrastRatio } from '../src/lib/contrast';
import { SEASONS } from '../src/lib/seasons';

type Tokens = Record<string, string>;

const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Declarations of the rule whose selector is exactly `selector` (a rule starts its own line). */
function block(selector: string): Tokens {
	const match = new RegExp(`(?:^|\\n)[ \\t]*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css);
	if (!match) throw new Error(`Selector not found in src/app.css: ${selector}`);
	const tokens: Tokens = {};
	for (const decl of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		tokens[decl[1]] = decl[2].trim();
	}
	return tokens;
}

interface Pair {
	label: string;
	fg: string;
	bg: string;
	min: number;
}

/** Foreground and background pairs worth checking, with the WCAG minimum each one needs. */
const PAIRS: Pair[] = [
	{ label: 'text on surface', fg: '--text', bg: '--surface', min: 4.5 },
	{ label: 'text on bg', fg: '--text', bg: '--bg', min: 4.5 },
	{ label: 'text-muted on surface', fg: '--text-muted', bg: '--surface', min: 4.5 },
	{ label: 'accent-text on accent', fg: '--accent-text', bg: '--accent', min: 4.5 },
	{ label: 'accent-soft-text on surface', fg: '--accent-soft-text', bg: '--surface', min: 4.5 },
	// Chips use --accent-soft as their background, so check the text on the tinted surface as well.
	{
		label: 'accent-soft-text on accent-soft',
		fg: '--accent-soft-text',
		bg: '--accent-soft',
		min: 4.5
	},
	{ label: 'accent on surface', fg: '--accent', bg: '--surface', min: 3 }
];

interface Palette {
	season: string;
	scheme: 'dark' | 'light';
	tokens: Tokens;
	/** False for the pre-existing base palettes: shown for reference, a miss only warns. */
	enforce: boolean;
}

const baseDark = block(':root');
const baseLight = {
	...block(":root:not([data-theme='dark'])"),
	...block(":root[data-theme='light']")
};

const failures: string[] = [];
const palettes: Palette[] = [
	{ season: 'base', scheme: 'dark', tokens: baseDark, enforce: false },
	{ season: 'base', scheme: 'light', tokens: { ...baseDark, ...baseLight }, enforce: false }
];

for (const { id } of SEASONS) {
	const dark = block(`:root[data-season='${id}']`);
	const lightMedia = block(`:root[data-season='${id}']:not([data-theme='dark'])`);
	const lightForced = block(`:root[data-season='${id}'][data-theme='light']`);

	// The two light variants (OS preference and forced) must stay in sync.
	const mediaKeys = Object.keys(lightMedia).sort();
	const forcedKeys = Object.keys(lightForced).sort();
	const inSync =
		mediaKeys.length === forcedKeys.length &&
		mediaKeys.every((key, i) => key === forcedKeys[i] && lightMedia[key] === lightForced[key]);
	if (!inSync) failures.push(`${id}: the two light variants differ`);

	// Cascade order in app.css: base dark, base light, season dark, season light.
	palettes.push({ season: id, scheme: 'dark', tokens: { ...baseDark, ...dark }, enforce: true });
	palettes.push({
		season: id,
		scheme: 'light',
		tokens: { ...baseDark, ...baseLight, ...dark, ...lightForced },
		enforce: true
	});
}

/** Resolves a token to an opaque hex, flattening rgba() over the palette's surface. */
function resolve(tokens: Tokens, name: string): string {
	const value = tokens[name];
	if (!value) throw new Error(`Token ${name} is missing`);
	return value.startsWith('rgba') ? composite(value, tokens['--surface']) : value;
}

const rows: string[][] = [['season', 'scheme', 'pair', 'ratio', 'min', 'ok']];
for (const { season, scheme, tokens, enforce } of palettes) {
	for (const pair of PAIRS) {
		const ratio = contrastRatio(resolve(tokens, pair.fg), resolve(tokens, pair.bg));
		const ok = ratio >= pair.min;
		const verdict = ok ? 'ok' : enforce ? 'FAIL' : 'warn';
		rows.push([season, scheme, pair.label, ratio.toFixed(2), String(pair.min), verdict]);
		if (!ok && enforce)
			failures.push(`${season} ${scheme}: ${pair.label} is ${ratio.toFixed(2)}, needs ${pair.min}`);
	}
}

const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
for (const row of rows) {
	console.log(
		row
			.map((cell, col) => cell.padEnd(widths[col]))
			.join('  ')
			.trimEnd()
	);
}

if (failures.length > 0) {
	console.error(`\n${failures.length} problem(s):`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log(`\nAll ${rows.length - 1} pairs pass.`);
