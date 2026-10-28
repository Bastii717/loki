import { render } from 'svelte/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { timeOut, userWithSession } from '../../../lib/server/moderation-test-utils';
import { getPrefs, setPrefs } from '../../../lib/server/notifications';
import { callRoute } from '../../../lib/server/test-request';
import { actions as maintenanceActions } from '../../moderation/maintenance/+page.server';
import Page from './+page.svelte';
import { actions, load } from './+page.server';

beforeAll(setupDb);
beforeEach(resetDb);

type Member = Awaited<ReturnType<typeof userWithSession>>;

const ALL_ON = { comments: true, threadComments: true, reportOutcomes: true };
const ALL_OFF = { comments: false, threadComments: false, reportOutcomes: false };

const save = (member: Member, form: Record<string, string>) =>
	callRoute({
		handler: actions.save,
		path: '/profile/notifications?/save',
		method: 'POST',
		session: member.session,
		form
	});

describe('preferences load', () => {
	it('returns all three preferences on for a member without a row', async () => {
		const member = await userWithSession();
		const data = await load({ locals: { user: member.user } } as never);
		expect(data).toEqual({ prefs: ALL_ON });
	});

	it('returns the stored preferences', async () => {
		const member = await userWithSession();
		const prefs = { comments: false, threadComments: true, reportOutcomes: false };
		await setPrefs(member.user.id, prefs);
		const data = await load({ locals: { user: member.user } } as never);
		expect(data).toEqual({ prefs });
	});
});

describe('save action', () => {
	it('exposes only the named save action', () => {
		expect(Object.keys(actions)).toEqual(['save']);
	});

	it('stores a present checkbox as on and an absent one as off', async () => {
		const member = await userWithSession();
		const res = await save(member, { comments: 'on' });
		expect(res.response.status).toBe(204);
		expect(await getPrefs(member.user.id)).toEqual({
			comments: true,
			threadComments: false,
			reportOutcomes: false
		});
	});

	it('turns everything off when no checkbox is sent and back on again later', async () => {
		const member = await userWithSession();
		await save(member, {});
		expect(await getPrefs(member.user.id)).toEqual(ALL_OFF);
		await save(member, { comments: 'on', threadComments: 'on', reportOutcomes: 'on' });
		expect(await getPrefs(member.user.id)).toEqual(ALL_ON);
	});

	it('returns saved: true', async () => {
		const member = await userWithSession();
		const request = new Request('https://loki.test/profile/notifications?/save', {
			method: 'POST',
			body: new URLSearchParams({ comments: 'on' })
		});
		const result = await actions.save({ locals: { user: member.user }, request } as never);
		expect(result).toEqual({ saved: true });
	});

	it('only changes the preferences of the signed-in member', async () => {
		const member = await userWithSession();
		const other = await userWithSession();
		await save(member, {});
		expect(await getPrefs(other.user.id)).toEqual(ALL_ON);
	});

	it('lets a muted member save', async () => {
		const member = await userWithSession();
		const mod = await userWithSession('moderator');
		await timeOut(member.user.id, mod.user.id);
		const res = await save(member, { threadComments: 'on' });
		expect(res.response.status).toBe(204);
		expect(await getPrefs(member.user.id)).toEqual({
			comments: false,
			threadComments: true,
			reportOutcomes: false
		});
	});

	it('is refused while writes are locked for maintenance', async () => {
		const member = await userWithSession();
		const admin = await userWithSession('admin');
		const lock = await callRoute({
			handler: maintenanceActions.save,
			path: '/moderation/maintenance?/save',
			method: 'POST',
			session: admin.session,
			form: { enabled: 'on', message: '', startsAt: '', until: '' }
		});
		// an action's plain result reaches callRoute as an empty 204
		expect(lock.response.status).toBe(204);
		const res = await save(member, {});
		expect(res.response.status).toBe(503);
		expect(await getPrefs(member.user.id)).toEqual(ALL_ON);
	});
});

const render_ = (props: Record<string, unknown>) =>
	render(Page as never, { props: props as never });
const html = (props: Record<string, unknown>) => render_(props).body;

describe('preferences page', () => {
	it('has the title, the heading and a back link to the profile', () => {
		const out = render_({ data: { prefs: ALL_ON }, form: null });
		expect(out.head).toContain('<title>Notifications · Loki</title>');
		expect(out.body).toMatch(/<h1[^>]*>Notifications<\/h1>/);
		expect(out.body).toMatch(/<a[^>]*href="\/profile"[^>]*aria-label="Back to profile"/);
	});

	it('renders the three labelled checkboxes checked from the defaults', () => {
		const body = html({ data: { prefs: ALL_ON }, form: null });
		const boxes = [...body.matchAll(/<label[^>]*>[\s\S]*?<\/label>/g)].map((m) => m[0]);
		expect(boxes).toHaveLength(3);
		const expected = [
			['comments', 'Comments on my memes'],
			['threadComments', 'New comments in threads I joined'],
			['reportOutcomes', 'Outcomes of my reports']
		];
		expected.forEach(([name, label], i) => {
			expect(boxes[i]).toMatch(
				new RegExp(`<input[^>]*type="checkbox"[^>]*name="${name}"[^>]*checked`)
			);
			expect(boxes[i]).toContain(label);
		});
	});

	it('leaves a stored-off preference unchecked', () => {
		const body = html({
			data: { prefs: { comments: true, threadComments: false, reportOutcomes: true } },
			form: null
		});
		expect(body).toMatch(/name="comments"[^>]*checked/);
		expect(body).not.toMatch(/name="threadComments"[^>]*checked/);
		expect(body).toMatch(/name="reportOutcomes"[^>]*checked/);
	});

	it('posts to ?/save and has a Save button', () => {
		const body = html({ data: { prefs: ALL_ON }, form: null });
		const form = /<form[^>]*action="\?\/save"[\s\S]*?<\/form>/.exec(body)![0];
		expect(form).toMatch(/method="POST"/i);
		expect(form).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*?Save[\s\S]*?<\/button>/);
	});

	it('says what is always on', () => {
		expect(html({ data: { prefs: ALL_ON }, form: null })).toContain(
			'Always on: moderation actions on your content, timeouts, and admin changes to your profile.'
		);
	});

	it('confirms a save and shows nothing before one', () => {
		expect(html({ data: { prefs: ALL_ON }, form: null })).not.toContain('Saved.');
		expect(html({ data: { prefs: ALL_ON }, form: { saved: true } })).toContain('Saved.');
	});
});
