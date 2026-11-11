import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { auditLog, siteContent, users } from './db/schema';
import { eq } from 'drizzle-orm';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { timeOut } from './moderation-test-utils';
import { TimeoutActiveError } from './moderation';
import {
	ContentPermissionError,
	acceptRules,
	getContent,
	needsRulesAcceptance,
	saveContent
} from './content';
import type { SessionUser } from './auth/session';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

async function userWithRole(role: SessionUser['role']): Promise<SessionUser> {
	const u = await testUser({ role });
	return { id: u.id, username: u.username, displayName: u.displayName, role };
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

	it('strips style, form and input tags but keeps benign markup', async () => {
		const admin = await userWithRole('admin');
		await saveContent(
			admin,
			'rules',
			[
				'# Titel',
				'',
				'- Punkt eins',
				'- Punkt zwei',
				'',
				'[Link](https://example.com/rules)',
				'',
				'<style>body{display:none}</style>',
				'',
				'<form action="https://evil.test"><input name="pw" type="password"><button>Go</button></form>'
			].join('\n')
		);
		const { html } = await getContent('rules');
		expect(html).not.toMatch(/<style/i);
		expect(html).not.toMatch(/<form/i);
		expect(html).not.toMatch(/<input/i);
		expect(html).not.toContain('display:none');
		expect(html).toContain('<h1>Titel</h1>');
		expect(html).toContain('<li>Punkt eins</li>');
		expect(html).toContain('<a href="https://example.com/rules">Link</a>');
	});

	it.each(['member', 'moderator'] as const)('rejects saving as %s', async (role) => {
		const u = await userWithRole(role);
		await expect(saveContent(u, 'rules', 'x')).rejects.toBeInstanceOf(ContentPermissionError);
		expect((await getContent('rules')).markdown).toBe('');
	});

	it('audits every save as site_content_changed with the key', async () => {
		const admin = await userWithRole('admin');
		await saveContent(admin, 'rules', 'eins');
		await saveContent(admin, 'faq', 'zwei');
		const rows = await db.select().from(auditLog);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			action: 'site_content_changed',
			actorId: admin.id,
			targetType: 'site_content',
			detail: 'rules'
		});
		expect(rows[1].detail).toBe('faq');
	});

	it('writes no audit row for a rejected save', async () => {
		const mod = await userWithRole('moderator');
		await expect(saveContent(mod, 'rules', 'x')).rejects.toBeInstanceOf(ContentPermissionError);
		expect(await db.select().from(auditLog)).toHaveLength(0);
	});

	it('refuses a timed-out admin with TimeoutActiveError and changes nothing', async () => {
		const admin = await userWithRole('admin');
		const other = await userWithRole('admin');
		await timeOut(admin.id, other.id);
		await expect(saveContent(admin, 'rules', 'x')).rejects.toBeInstanceOf(TimeoutActiveError);
		expect((await getContent('rules')).markdown).toBe('');
		expect(await db.select().from(auditLog)).toHaveLength(0);
	});
});

const acceptedAt = async (id: number) =>
	(await db.select().from(users).where(eq(users.id, id)))[0].rulesAcceptedAt;

describe('saveContent no-op and self-acceptance', () => {
	it('does not bump updatedAt or audit when the markdown is unchanged', async () => {
		const admin = await userWithRole('admin');
		await saveContent(admin, 'rules', 'Regeln');
		const before = (await getContent('rules')).updatedAt;
		await saveContent(admin, 'rules', 'Regeln');
		expect((await getContent('rules')).updatedAt).toEqual(before);
		expect(await db.select().from(auditLog)).toHaveLength(1);
	});

	it('records the saving admin as having accepted the new rules', async () => {
		const admin = await userWithRole('admin');
		const other = await userWithRole('admin');
		await saveContent(admin, 'rules', 'Regeln');
		const accepted = await acceptedAt(admin.id);
		expect(accepted).toBeInstanceOf(Date);
		expect(accepted).toEqual((await getContent('rules')).updatedAt);
		expect(await acceptedAt(other.id)).toBeNull();
		expect(await needsRulesAcceptance({ rulesAcceptedAt: accepted })).toBe(false);
	});

	it('does not touch the admin acceptance when saving the faq', async () => {
		const admin = await userWithRole('admin');
		await saveContent(admin, 'faq', 'Fragen');
		expect(await acceptedAt(admin.id)).toBeNull();
	});
});

describe('needsRulesAcceptance', () => {
	const put = (markdown: string, updatedAt: Date) =>
		db.insert(siteContent).values({ key: 'rules', markdown, updatedAt });

	it('is false when there are no rules', async () => {
		expect(await needsRulesAcceptance({ rulesAcceptedAt: null })).toBe(false);
		await put('  \n ', new Date());
		expect(await needsRulesAcceptance({ rulesAcceptedAt: null })).toBe(false);
	});

	it('is true for rules the member never accepted', async () => {
		await put('Regeln', new Date());
		expect(await needsRulesAcceptance({ rulesAcceptedAt: null })).toBe(true);
	});

	it('is false when accepted after the last change', async () => {
		await put('Regeln', new Date('2026-01-01T00:00:00Z'));
		expect(await needsRulesAcceptance({ rulesAcceptedAt: new Date('2026-01-02T00:00:00Z') })).toBe(
			false
		);
	});

	it('is true when accepted before the last change', async () => {
		await put('Regeln', new Date('2026-01-02T00:00:00Z'));
		expect(await needsRulesAcceptance({ rulesAcceptedAt: new Date('2026-01-01T00:00:00Z') })).toBe(
			true
		);
	});
});

describe('acceptRules', () => {
	it('sets the timestamp, also while timed out', async () => {
		const member = await userWithRole('member');
		const other = await userWithRole('admin');
		await timeOut(member.id, other.id);
		await acceptRules(member.id);
		expect(await acceptedAt(member.id)).toBeInstanceOf(Date);
	});
});
