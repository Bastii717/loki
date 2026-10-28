import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AwardChips from './AwardChips.svelte';

describe('AwardChips', () => {
	it('renders nothing for an empty list', () => {
		const { body } = render(AwardChips, { props: { awards: [] } });
		expect(body).not.toContain('<a');
		expect(body).not.toContain('chip');
	});

	it('renders a chip per month with its link and a label that contains the visible text', () => {
		const { body } = render(AwardChips, {
			props: { awards: [{ month: '2026-10' }, { month: '2026-08' }] }
		});
		expect(body.match(/<a[^>]*class="chip[ "]/g)).toHaveLength(2);
		expect(body).toMatch(
			/<a[^>]*href="\/awards\?from=2026-10#2026-10"[^>]*aria-label="Meme of the Month, Oct 2026"[^>]*>[\s\S]*?lucide-trophy[\s\S]*?Oct 2026/
		);
		expect(body).toMatch(
			/<a[^>]*href="\/awards\?from=2026-08#2026-08"[^>]*aria-label="Meme of the Month, Aug 2026"[^>]*>[\s\S]*?Aug 2026/
		);
		expect(body.indexOf('Oct 2026')).toBeLessThan(body.indexOf('Aug 2026'));
	});
});
