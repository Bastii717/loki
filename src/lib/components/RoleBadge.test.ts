import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RoleBadge from './RoleBadge.svelte';

describe('RoleBadge', () => {
	it('labels a moderator', () => {
		const { body } = render(RoleBadge, { props: { role: 'moderator' } });
		expect(body).toContain('role="img"');
		expect(body).toContain('aria-label="Moderator"');
		expect(body).not.toContain('Admin');
	});

	it('labels an admin', () => {
		const { body } = render(RoleBadge, { props: { role: 'admin' } });
		expect(body).toContain('role="img"');
		expect(body).toContain('aria-label="Admin"');
		expect(body).not.toContain('Moderator');
	});

	it('renders nothing for members', () => {
		const { body } = render(RoleBadge, { props: { role: 'member' } });
		expect(body).not.toContain('role="img"');
		expect(body).not.toContain('<svg');
		expect(body).not.toContain('aria-label');
	});

	it('draws a 14 px icon', () => {
		const { body } = render(RoleBadge, { props: { role: 'admin' } });
		expect(body).toMatch(/<svg[^>]*width="14"[^>]*height="14"/);
	});
});
