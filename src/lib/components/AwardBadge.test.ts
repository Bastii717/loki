import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AwardBadge from './AwardBadge.svelte';

describe('AwardBadge', () => {
	it('shows the short month in the text and the long month in title and aria-label', () => {
		const { body } = render(AwardBadge, { props: { month: '2026-10' } });
		expect(body).toContain('Meme of the Month · Oct 2026');
		expect(body).toContain('title="Meme of the Month, October 2026"');
		expect(body).toContain('aria-label="Meme of the Month, October 2026"');
	});

	it('draws a 12 px decorative trophy', () => {
		const { body } = render(AwardBadge, { props: { month: '2026-01' } });
		expect(body).toMatch(/<svg[^>]*width="12"[^>]*height="12"/);
		expect(body).toContain('aria-hidden="true"');
		expect(body).toContain('Jan 2026');
	});
});
