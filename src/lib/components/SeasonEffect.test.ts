import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { PARTICLE_COUNTS } from '../season-effects';
import SeasonEffect from './SeasonEffect.svelte';

const html = (season: unknown) => render(SeasonEffect, { props: { season } as never }).body;

describe('SeasonEffect', () => {
	it('renders nothing outside a season', () => {
		expect(html(null)).not.toContain('season-fx');
		expect(html(undefined)).not.toContain('season-fx');
	});

	it.each([
		['advent', 'snow'],
		['halloween', 'bats'],
		['carnival', 'confetti'],
		['party', 'sparkles']
	] as const)('draws %s as %s', (season, kind) => {
		const body = html(season);
		expect(body).toMatch(new RegExp(`class="season-fx ${kind}[^"]*"`));
		expect(body).toContain(`data-effect="${kind}"`);
		expect(body.match(/<i\b/g)).toHaveLength(PARTICLE_COUNTS[kind]);
	});

	it('is pure decoration: hidden from assistive tech, nothing to focus or click', () => {
		const body = html('advent');
		expect(body).toContain('aria-hidden="true"');
		expect(body).not.toMatch(/<(a|button|input)\b/);
		expect(body).not.toContain('tabindex');
	});

	it('positions each particle through inline custom properties', () => {
		const body = html('carnival');
		expect(body).toMatch(/<i [^>]*style="left: [\d.]+%; --s: [\d.]+px; --drift: -?[\d.]+px;/);
		expect(body).toContain('--c: #');
	});
});
