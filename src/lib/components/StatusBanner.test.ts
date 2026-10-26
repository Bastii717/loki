import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import StatusBanner from './StatusBanner.svelte';

describe('StatusBanner', () => {
	it('announces a planned maintenance politely, with the accent border', () => {
		const { body } = render(StatusBanner, {
			props: { state: 'announced', message: 'Heads up: maintenance tonight.' }
		});
		expect(body).toContain('role="status"');
		expect(body).toContain('Heads up: maintenance tonight.');
		expect(body).toContain('lucide-megaphone');
		expect(body).not.toMatch(/\bdown\b/);
	});

	it('raises an alert while in maintenance', () => {
		const { body } = render(StatusBanner, {
			props: { state: 'maintenance', message: 'Loki is under maintenance.' }
		});
		expect(body).toContain('role="alert"');
		expect(body).toContain('Loki is under maintenance.');
		expect(body).toContain('lucide-wrench');
		expect(body).not.toMatch(/\bdown\b/);
	});

	it('raises an alert with the down colour while starting up', () => {
		const { body } = render(StatusBanner, {
			props: { state: 'not_ready', message: 'Loki is still starting up.' }
		});
		expect(body).toContain('role="alert"');
		expect(body).toContain('Loki is still starting up.');
		expect(body).toContain('lucide-hourglass');
		expect(body).toMatch(/class="banner[^"]*\bdown\b/);
	});

	it.each(['ok', 'down'] as const)('renders nothing for %s', (state) => {
		const { body } = render(StatusBanner, { props: { state, message: null } });
		expect(body).not.toContain('role=');
		expect(body).not.toContain('banner');
	});
});
