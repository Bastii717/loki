import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const data = (over: Record<string, unknown> = {}) => ({
	profile: {
		username: 'user1',
		displayName: 'Lena K',
		motto: 'hi',
		avatarKey: 'avatars/u1/x-256.webp',
		avatarThumbKey: 'avatars/u1/x-64.webp',
		...over
	},
	nextRenameAt: null,
	setByAdmin: false,
	isAdmin: false
});

const html = (props: Record<string, unknown>) =>
	render(Page as never, { props: props as never }).body;

/** The main form is the one that posts `?/save`, up to its closing tag. */
const mainForm = (body: string) => /<form[^>]*action="\?\/save"[\s\S]*?<\/form>/.exec(body)![0];

describe('editor page', () => {
	it('keeps Remove avatar out of the main form so Enter submits Save', () => {
		const body = html({ data: data(), form: null });
		const main = mainForm(body);
		expect(main).not.toContain('?/removeAvatar');
		// the remove button belongs to the separate form through its form attribute, so Save is the
		// first submit button the main form owns (the one Enter triggers)
		expect(body).toContain('form="remove-avatar"');
		expect(body).toMatch(/<form[^>]*id="remove-avatar"[^>]*action="\?\/removeAvatar"/);
		const owned = [...main.matchAll(/<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/g)]
			.map((m) => m[0])
			.filter((b) => !b.includes('form="remove-avatar"'));
		expect(owned).toHaveLength(1);
		expect(owned[0]).toContain('Save');
	});

	it('keeps the display name in a locked field after a failure without echo', () => {
		const body = html({
			data: { ...data(), nextRenameAt: '2099-01-01T00:00:00.000Z' },
			form: { error: 'Image is too large.', displayName: '', motto: 'typed' }
		});
		expect(body).toMatch(/name="displayName"[^>]*value="Lena K"/);
		expect(body).toMatch(/name="motto"[^>]*value="typed"/);
	});

	it('says when an admin set the name', () => {
		expect(html({ data: data(), form: null })).not.toContain('An admin set this name.');
		const body = html({ data: { ...data(), setByAdmin: true }, form: null });
		expect(body).toContain('An admin set this name.');
	});

	it('tells admins they can rename at any time instead of the 30-day rule', () => {
		const member = html({ data: data(), form: null });
		expect(member).toContain('once every 30 days');
		const admin = html({ data: { ...data(), isAdmin: true }, form: null });
		expect(admin).toContain('Admins can change their name at any time.');
		expect(admin).toContain('Your username stays user1.');
		expect(admin).not.toContain('30 days');
	});

	it('keeps the saved values after a failure that carries no echo', () => {
		const body = html({ data: data(), form: { error: 'busy' } });
		expect(body).toMatch(/name="displayName"[^>]*value="Lena K"/);
		expect(body).toMatch(/name="motto"[^>]*value="hi"/);
	});
});
