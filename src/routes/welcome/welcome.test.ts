import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acceptRules, saveContent } from '../../lib/server/content';
import { validateSession } from '../../lib/server/auth/session';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { timeOut, userWithSession } from '../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { callRoute } from '../../lib/server/test-request';
import { actions, load } from './+page.server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

// any app route will do: the gate sits in the hook, in front of every handler
const page = async () => new Response('page');

async function world(rules: string | null = 'Be nice') {
	const admin = await userWithSession('admin');
	if (rules !== null) await saveContent(admin.user, 'rules', rules);
	const member = await userWithSession('member');
	return { admin, member };
}

const accept = (session: string, form: Record<string, string> = { agree: 'on' }) =>
	callRoute({
		handler: actions.accept as never,
		path: '/welcome',
		method: 'POST',
		form,
		session
	});

const vote = (session: string) =>
	callRoute({ handler: page, path: '/api/memes/x/vote', method: 'POST', session });

describe('rules gate in the hook', () => {
	it('redirects page reads to /welcome until the rules are accepted', async () => {
		const { member } = await world();
		const { response } = await callRoute({ handler: page, path: '/', session: member.session });
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/welcome');
	});

	it('blocks mutations with 403, in the shape of their client', async () => {
		const { member } = await world();
		const api = await vote(member.session);
		expect(api.response.status).toBe(403);
		expect(await api.response.json()).toEqual({ message: 'Please accept the house rules first.' });
		const plain = await callRoute({
			handler: page,
			path: '/profile/edit',
			method: 'POST',
			session: member.session
		});
		expect(plain.response.status).toBe(403);
		expect(await plain.response.text()).toBe('Please accept the house rules first.');
		const enhanced = await callRoute({
			handler: page,
			path: '/profile/edit',
			method: 'POST',
			form: { a: 'b' },
			session: member.session
		});
		expect(enhanced.response.status).toBe(403);
		expect((await enhanced.response.json()).type).toBe('failure');
	});

	it('keeps /welcome and sign-out reachable', async () => {
		const { member } = await world();
		const get = await callRoute({ handler: page, path: '/welcome', session: member.session });
		expect(get.response.status).toBe(200);
		const out = await callRoute({
			handler: page,
			path: '/logout',
			method: 'POST',
			session: member.session
		});
		expect(out.response.status).toBe(200);
	});

	it('does not redirect or block while there are no rules', async () => {
		const { member } = await world(null);
		const get = await callRoute({ handler: page, path: '/', session: member.session });
		expect(get.response.status).toBe(200);
		expect((await vote(member.session)).response.status).toBe(200);
	});

	it('lets everything through after accepting', async () => {
		const { member } = await world();
		expect((await accept(member.session)).response.status).toBe(303);
		const get = await callRoute({ handler: page, path: '/', session: member.session });
		expect(get.response.status).toBe(200);
		expect((await vote(member.session)).response.status).toBe(200);
	});

	it('asks again after the rules changed, but not the admin who saved them', async () => {
		const { admin, member } = await world();
		await accept(member.session);
		await new Promise((r) => setTimeout(r, 5));
		await saveContent(admin.user, 'rules', 'Be nicer');
		expect((await vote(member.session)).response.status).toBe(403);
		expect((await vote(admin.session)).response.status).toBe(200);
	});
});

describe('/welcome load', () => {
	const run = async (session: string) => {
		const { response } = await callRoute({
			handler: (async (e: { locals: App.Locals }) => {
				const data = await (load as unknown as (e: unknown) => Promise<unknown>)(e);
				return Response.json(data);
			}) as never,
			path: '/welcome',
			session
		});
		return response;
	};

	it('redirects to / when no acceptance is needed', async () => {
		const { member } = await world(null);
		const res = await run(member.session);
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/');
	});

	it('returns the rendered rules, not changed, for a first-time member', async () => {
		const { member } = await world('# Be nice');
		const body = await (await run(member.session)).json();
		expect(body.html).toContain('<h1>Be nice</h1>');
		expect(body.changed).toBe(false);
	});

	it('flags changed when an earlier version was accepted', async () => {
		const { admin, member } = await world('one');
		await acceptRules(member.user.id);
		await new Promise((r) => setTimeout(r, 5));
		await saveContent(admin.user, 'rules', 'two');
		expect((await (await run(member.session)).json()).changed).toBe(true);
	});
});

describe('/welcome accept action', () => {
	it('redirects to / and records the acceptance', async () => {
		const { member } = await world();
		const res = await accept(member.session);
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe('/');
		const get = await callRoute({ handler: page, path: '/', session: member.session });
		expect(get.response.status).toBe(200);
	});

	it('refuses without the checkbox and stays gated', async () => {
		const { member } = await world();
		const event = {
			locals: { user: await validateSession(member.session) },
			request: new Request('https://loki.test/welcome', { method: 'POST', body: new FormData() })
		};
		const result = await (actions.accept as unknown as (e: unknown) => Promise<unknown>)(event);
		expect(result).toMatchObject({ status: 400, data: { error: expect.any(String) } });
		const get = await callRoute({ handler: page, path: '/', session: member.session });
		expect(get.response.status).toBe(303);
	});

	it('works while timed out', async () => {
		const { member } = await world();
		const other = await userWithSession('admin');
		await timeOut(member.user.id, other.user.id);
		expect((await accept(member.session)).response.status).toBe(303);
	});
});
