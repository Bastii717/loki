import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { ContentPermissionError, getContent, saveContent } from './content';
import type { SessionUser } from './auth/session';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

async function userWithRole(role: SessionUser['role']): Promise<SessionUser> {
	const u = await testUser({ role });
	return { id: u.id, username: u.username, role };
}

describe('content', () => {
	it('returns an empty result when nothing was saved', async () => {
		expect(await getContent('rules')).toEqual({ html: '', markdown: '', updatedAt: null });
	});

	it('round-trips markdown and renders it to html', async () => {
		const admin = await userWithRole('admin');
		await saveContent(admin, 'rules', '# Regeln\n\n- **Sei nett**');
		const c = await getContent('rules');
		expect(c.markdown).toBe('# Regeln\n\n- **Sei nett**');
		expect(c.html).toContain('<h1>Regeln</h1>');
		expect(c.html).toContain('<strong>Sei nett</strong>');
		expect(c.updatedAt).toBeInstanceOf(Date);
		// a second save overwrites, and keys are independent
		await saveContent(admin, 'rules', 'neu');
		expect((await getContent('rules')).markdown).toBe('neu');
		expect((await getContent('faq')).markdown).toBe('');
	});

	it('strips script tags from rendered html', async () => {
		const admin = await userWithRole('admin');
		await saveContent(admin, 'faq', 'Hallo\n\n<script>alert(1)</script>');
		const c = await getContent('faq');
		expect(c.html).not.toContain('<script');
		expect(c.html).not.toContain('alert(1)');
		expect(c.html).toContain('Hallo');
	});

	it('strips event handlers and javascript: urls', async () => {
		const admin = await userWithRole('admin');
		await saveContent(
			admin,
			'faq',
			'<img src="x" onerror="alert(1)">\n\n[klick](javascript:alert(2))'
		);
		const c = await getContent('faq');
		expect(c.html).not.toContain('onerror');
		expect(c.html).not.toContain('javascript:');
	});

	it.each(['member', 'moderator'] as const)('rejects saving as %s', async (role) => {
		const u = await userWithRole(role);
		await expect(saveContent(u, 'rules', 'x')).rejects.toBeInstanceOf(ContentPermissionError);
		expect((await getContent('rules')).markdown).toBe('');
	});
});
