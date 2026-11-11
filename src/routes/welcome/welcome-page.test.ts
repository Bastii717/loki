import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const html = '<h1>Be nice</h1><p>No harassment.</p>';
const view = (changed: boolean) =>
	render(Page as never, { props: { data: { html, changed }, form: null } as never }).body;

describe('welcome page', () => {
	it('shows the rules, a checkbox-gated button and a sign-out link', () => {
		const body = view(false);
		expect(body).toContain('Welcome to Loki');
		expect(body).toContain('lucide-shield');
		expect(body).toContain('House rules');
		expect(body).toContain('One quick read before you jump in');
		expect(body).toContain('<h1>Be nice</h1>');
		expect(body).toContain('name="agree"');
		expect(body).toContain("I've read the house rules and I'll stick to them.");
		expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Accept &amp; enter Loki/);
		expect(body).toContain('action="/logout"');
		expect(body).toContain('Sign out instead');
		expect(body).not.toContain('The house rules changed.');
	});

	it('shows the changed banner and the re-accept label after a rules change', () => {
		const body = view(true);
		expect(body).toContain(
			'The house rules changed. Please read them again and re-accept to continue.'
		);
		expect(body).toContain('Accept the updated rules');
		expect(body).not.toContain('Accept &amp; enter Loki');
	});
});
