import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/server/db';
import { comments, media, quotes, reports, timeouts } from '../../lib/server/db/schema';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { setFlags } from '../../lib/server/memes';
import {
	activeTimeout,
	liftTimeout,
	resolveReports,
	setTimeout_
} from '../../lib/server/moderation';
import {
	addOpenReports,
	insertComment,
	insertMeme,
	insertQuote,
	timeOut,
	userWithSession
} from '../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { ensureBucket } from '../../lib/server/storage-test-utils';
import { callRoute } from '../../lib/server/test-request';
import { DELETE as deleteComment } from '../api/comments/[id]/+server';
import { DELETE as deleteMeme, PATCH as patchMeme } from '../api/memes/[id]/+server';
import { POST as caseAction } from '../api/moderation/case/+server';
import { POST as setTimeoutRoute } from '../api/moderation/timeouts/+server';
import { DELETE as liftTimeoutRoute } from '../api/moderation/timeouts/[userId]/+server';
import { GET as searchUsers } from '../api/moderation/users/+server';
import { POST as userProfile } from '../api/moderation/users/[id]/profile/+server';
import { DELETE as deleteQuote } from '../api/quotes/[id]/+server';
import { load as rootLayout } from '../+layout.server';
import { load as moderationLayout } from './+layout.server';
import { load as queue } from './+page.server';
import { load as done } from './resolved/+page.server';
import { load as log } from './log/+page.server';
import { load as usersPage } from './users/+page.server';
import { load as timeoutsPage } from './timeouts/+page.server';
import { actions as maintenanceActions, load as maintenancePage } from './maintenance/+page.server';
import { actions as themeActions, load as themePage } from './theme/+page.server';

/** Fixed far-future mute end, so the formatted date never depends on the run date. */
const MUTED_UNTIL = new Date('2099-12-24T12:00:00Z');

beforeAll(async () => {
	await setupDb();
	await ensureBucket(); // meme deletion removes bucket objects
});
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

type World = Awaited<ReturnType<typeof world>>;

/** One user per role, a timed-out moderator and admin, and an open case to poke at. */
async function world() {
	const [member, mod, admin, victim] = await Promise.all([
		userWithSession('member'),
		userWithSession('moderator'),
		userWithSession('admin'),
		userWithSession('member')
	]);
	const [lockedMod, lockedAdmin] = await Promise.all([
		userWithSession('moderator'),
		userWithSession('admin')
	]);
	const memeId = await insertMeme(victim.user.id, 'Fall');
	await addOpenReports('meme', memeId, victim.user.id, 2);
	await timeOut(lockedMod.user.id, admin.user.id, MUTED_UNTIL);
	await timeOut(lockedAdmin.user.id, admin.user.id, MUTED_UNTIL);
	return { member, mod, admin, victim, lockedMod, lockedAdmin, memeId };
}

interface Endpoint {
	name: string;
	/** Needs the admin role (everything else: moderator or admin). */
	adminOnly?: boolean;
	page: boolean;
	call: (w: World, session: string) => Parameters<typeof callRoute>[0];
}

const endpoints: Endpoint[] = [
	{
		name: 'layout load',
		page: true,
		call: (_w, session) => ({ handler: moderationLayout, path: '/moderation', session })
	},
	{
		name: 'queue load',
		page: true,
		call: (_w, session) => ({ handler: queue, path: '/moderation', session })
	},
	{
		name: 'resolved load',
		page: true,
		call: (_w, session) => ({ handler: done, path: '/moderation/resolved', session })
	},
	{
		name: 'timeouts load',
		page: true,
		call: (_w, session) => ({ handler: timeoutsPage, path: '/moderation/timeouts', session })
	},
	{
		name: 'log load',
		page: true,
		call: (_w, session) => ({ handler: log, path: '/moderation/log', session })
	},
	{
		name: 'users load',
		page: true,
		adminOnly: true,
		call: (_w, session) => ({ handler: usersPage, path: '/moderation/users', session })
	},
	{
		name: 'maintenance load',
		page: true,
		adminOnly: true,
		call: (_w, session) => ({
			handler: maintenancePage,
			path: '/moderation/maintenance',
			session
		})
	},
	{
		name: 'maintenance save action',
		page: true, // a page form action: anonymous requests are redirected to /login
		adminOnly: true,
		call: (_w, session) => ({
			handler: maintenanceActions.save,
			path: '/moderation/maintenance?/save',
			method: 'POST',
			session,
			form: { message: '', startsAt: '', until: '' }
		})
	},
	{
		name: 'maintenance off action',
		page: true, // a page form action: anonymous requests are redirected to /login
		adminOnly: true,
		call: (_w, session) => ({
			handler: maintenanceActions.off,
			path: '/moderation/maintenance?/off',
			method: 'POST',
			session,
			form: {}
		})
	},
	{
		name: 'theme load',
		page: true,
		adminOnly: true,
		call: (_w, session) => ({ handler: themePage, path: '/moderation/theme', session })
	},
	{
		name: 'theme save action',
		page: true, // a page form action: anonymous requests are redirected to /login
		adminOnly: true,
		call: (_w, session) => ({
			handler: themeActions.save,
			path: '/moderation/theme?/save',
			method: 'POST',
			session,
			form: { mode: 'auto', theme: '', until: '' }
		})
	},
	{
		name: 'theme reset action',
		page: true, // a page form action: anonymous requests are redirected to /login
		adminOnly: true,
		call: (_w, session) => ({
			handler: themeActions.reset,
			path: '/moderation/theme?/reset',
			method: 'POST',
			session,
			form: {}
		})
	},
	{
		name: 'POST case',
		page: false,
		call: (w, session) => ({
			handler: caseAction,
			path: '/api/moderation/case',
			method: 'POST',
			session,
			body: { contentType: 'meme', contentId: w.memeId, action: 'release' }
		})
	},
	{
		name: 'POST timeouts',
		page: false,
		call: (w, session) => ({
			handler: setTimeoutRoute,
			path: '/api/moderation/timeouts',
			method: 'POST',
			session,
			body: { userId: w.victim.user.id, days: 2, reason: 'Test' }
		})
	},
	{
		name: 'DELETE timeouts/[userId]',
		page: false,
		call: (w, session) => ({
			handler: liftTimeoutRoute,
			path: `/api/moderation/timeouts/${w.victim.user.id}`,
			method: 'DELETE',
			params: { userId: String(w.victim.user.id) },
			session
		})
	},
	{
		name: 'POST users/[id]/profile',
		page: false,
		adminOnly: true,
		call: (w, session) => ({
			handler: userProfile,
			path: `/api/moderation/users/${w.victim.user.id}/profile`,
			method: 'POST',
			params: { id: String(w.victim.user.id) },
			session,
			body: { action: 'clearMotto' }
		})
	},
	{
		name: 'GET users',
		page: false,
		call: (_w, session) => ({
			handler: searchUsers,
			path: '/api/moderation/users?q=user',
			session
		})
	}
];

describe('Review Focus 1: members never reach the moderation area', () => {
	it.each(endpoints)('$name: anonymous is turned away', async (ep) => {
		const w = await world();
		const { response } = await callRoute(ep.call(w, ''));
		expect(response.status).toBe(ep.page ? 303 : 401);
	});

	it.each(endpoints)('$name: a member gets 403 and no data', async (ep) => {
		const w = await world();
		const { response } = await callRoute(ep.call(w, w.member.session));
		expect(response.status).toBe(403);
		const body = await response.text();
		expect(body).toMatch(/This area is for moderators and admins only/);
		expect(body).not.toContain(w.victim.user.username);
	});

	it.each(endpoints)('$name: moderators and admins pass the gate as far as allowed', async (ep) => {
		const w = await world();
		const forMod = await callRoute(ep.call(w, w.mod.session));
		if (ep.adminOnly) expect(forMod.response.status).toBe(403);
		else expect([401, 403]).not.toContain(forMod.response.status);
		const forAdmin = await callRoute(ep.call(w, w.admin.session));
		expect([401, 403]).not.toContain(forAdmin.response.status);
	});

	it('members cannot act: nothing changes after hitting every mutating API', async () => {
		const w = await world();
		await setTimeout_(w.admin.user, w.victim.user.id, 5, 'bleibt');
		for (const ep of endpoints.filter((e) => !e.page)) {
			expect((await callRoute(ep.call(w, w.member.session))).response.status).toBe(403);
		}
		expect(await db.select().from(reports).where(eq(reports.status, 'open'))).toHaveLength(2);
		const [meme] = await db.select().from(media).where(eq(media.id, w.memeId));
		expect(meme.reviewedAt).toBeNull();
		expect(await activeTimeout(w.victim.user.id)).toMatchObject({ reason: 'bleibt' });
	});
});

describe('hooks-level prefix guard (defense in depth)', () => {
	it.each([
		'/moderation',
		'/moderation/log',
		'/api/moderation/case',
		'/api/moderation/users',
		'/%6Doderation', // percent-encoded: SvelteKit routes it to /moderation
		'/api/moderation/%63ase'
	])('%s: a member is turned away before the route handler runs', async (path) => {
		const w = await world();
		const handler = vi.fn(() => new Response('geheim'));
		const { response } = await callRoute({ handler, path, session: w.member.session });
		expect(response.status).toBe(403);
		expect(await response.text()).not.toContain('geheim');
		expect(handler).not.toHaveBeenCalled();
	});

	it('moderators and admins reach the handler, and lookalike paths are not affected', async () => {
		const w = await world();
		const handler = vi.fn(() => new Response('ok'));
		for (const session of [w.mod.session, w.admin.session]) {
			expect((await callRoute({ handler, path: '/moderation', session })).response.status).toBe(
				200
			);
		}
		const lookalike = await callRoute({
			handler,
			path: '/moderations',
			session: w.member.session
		});
		expect(lookalike.response.status).toBe(200);
	});

	it('the per-route guard still rejects a member when the hook is bypassed', async () => {
		const w = await world();
		await expect(
			moderationLayout({ locals: { user: w.member.user }, parent: async () => ({}) } as never)
		).rejects.toMatchObject({ status: 403 });
	});
});

describe('timed-out moderators lose their moderation rights', () => {
	it.each(endpoints)('$name: a timed-out moderator gets 403 with the mute notice', async (ep) => {
		const w = await world();
		const { response } = await callRoute(ep.call(w, w.lockedMod.session));
		expect(response.status).toBe(403);
		const body = await response.text();
		if (ep.adminOnly) return expect(body).toContain('This area is for admins only'); // the role check comes first
		expect(body).toContain('You are muted until 24 Dec 2099: test');
		expect(body).toContain('Your moderation rights are paused until then');
	});

	it.each(endpoints)('$name: a timed-out admin loses them as well', async (ep) => {
		const w = await world();
		const { response } = await callRoute(ep.call(w, w.lockedAdmin.session));
		expect(response.status).toBe(403);
		expect(await response.text()).toContain('You are muted until');
	});

	it('the timed-out moderator gets access back once the timeout is lifted', async () => {
		const w = await world();
		await db
			.update(timeouts)
			.set({ liftedAt: new Date() })
			.where(eq(timeouts.userId, w.lockedMod.user.id));
		const { response } = await callRoute(endpoints[1].call(w, w.lockedMod.session));
		expect(response.status).toBe(204);
	});

	it('the queue actions leave the case untouched for a timed-out moderator', async () => {
		const w = await world();
		for (const action of ['release', 'flags', 'delete'] as const) {
			const { response } = await callRoute({
				handler: caseAction,
				path: '/api/moderation/case',
				method: 'POST',
				session: w.lockedMod.session,
				body: { contentType: 'meme', contentId: w.memeId, action }
			});
			expect(response.status).toBe(403);
		}
		expect(await db.select().from(media).where(eq(media.id, w.memeId))).toHaveLength(1);
		expect(await db.select().from(reports).where(eq(reports.status, 'open'))).toHaveLength(2);
	});

	it('direct moderation on foreign content is blocked too: flags, deletes of meme, comment and quote', async () => {
		const w = await world();
		const commentId = await insertComment(w.victim.user.id, w.memeId);
		const quoteId = await insertQuote(w.victim.user.id);
		const session = w.lockedMod.session;
		const calls = [
			callRoute({
				handler: patchMeme,
				path: `/api/memes/${w.memeId}`,
				method: 'PATCH',
				params: { id: String(w.memeId) },
				body: { nsfw: true },
				session
			}),
			callRoute({
				handler: deleteMeme,
				path: `/api/memes/${w.memeId}`,
				method: 'DELETE',
				params: { id: String(w.memeId) },
				session
			}),
			callRoute({
				handler: deleteComment,
				path: `/api/comments/${commentId}`,
				method: 'DELETE',
				params: { id: String(commentId) },
				session
			}),
			callRoute({
				handler: deleteQuote,
				path: `/api/quotes/${quoteId}`,
				method: 'DELETE',
				params: { id: String(quoteId) },
				session
			})
		];
		for (const { response } of await Promise.all(calls)) {
			expect(response.status).toBe(403);
			expect(await response.text()).toContain('You are muted until');
		}
		const [meme] = await db.select().from(media).where(eq(media.id, w.memeId));
		expect(meme.nsfw).toBe(false);
		expect(await db.select().from(comments)).toHaveLength(1);
		expect(await db.select().from(quotes)).toHaveLength(1);
	});

	it('setFlags on foreign content is gated at the module, so no caller can forget it', async () => {
		const w = await world();
		await expect(setFlags(w.lockedMod.user, w.memeId, { nsfw: true })).rejects.toThrow(/timed out/);
		// a healthy moderator is unaffected
		await setFlags(w.mod.user, w.memeId, { nsfw: true });
	});
});

describe('admin-only Users page', () => {
	const call = (user: World['mod']['user']) =>
		usersPage({ locals: { user } } as never) as Promise<{
			users: { id: number; username: string; role: string; confirmedReports: number }[];
		}>;

	it('refuses moderators even with a direct load call, serves admins the full list', async () => {
		const w = await world();
		await expect(call(w.mod.user)).rejects.toMatchObject({ status: 403 });
		await expect(call(w.member.user)).rejects.toMatchObject({ status: 403 });
		const { users } = await call(w.admin.user);
		expect(users.map((u) => u.id)).toEqual(
			expect.arrayContaining(
				[w.member, w.mod, w.admin, w.victim, w.lockedMod, w.lockedAdmin].map((u) => u.user.id)
			)
		);
		expect(users.find((u) => u.id === w.mod.user.id)?.role).toBe('moderator');
	});

	it('shows counts, active and past timeouts and confirmed reports', async () => {
		const w = await world();
		const commentId = await insertComment(w.victim.user.id, w.memeId);
		await insertQuote(w.victim.user.id);
		await resolveReports(w.admin.user, 'meme', w.memeId, 'actioned'); // two confirmed reports
		await addOpenReports('comment', commentId, w.victim.user.id, 1);
		await resolveReports(w.admin.user, 'comment', commentId, 'dismissed'); // not confirmed
		await setTimeout_(w.admin.user, w.victim.user.id, 3, 'erst');
		await setTimeout_(w.admin.user, w.victim.user.id, 4, 'dann');

		const { users } = (await usersPage({ locals: { user: w.admin.user } } as never)) as {
			users: Record<string, unknown>[];
		};
		const victim = users.find((u) => u.id === w.victim.user.id)!;
		expect(victim).toMatchObject({
			memes: 1,
			comments: 1,
			quotes: 1,
			confirmedReports: 2,
			confirmedCases: 1,
			activeTimeout: { reason: 'dann' }
		});
		expect((victim.pastTimeouts as { reason: string }[]).map((t) => t.reason)).toEqual(['erst']);
	});
});

describe('page data for moderators', () => {
	it('the queue load hands moderators the full case; members are refused before any query', async () => {
		const w = await world();
		const data = (await queue({
			locals: { user: w.mod.user },
			url: new URL('https://loki.test/moderation')
		} as never)) as { cases: { contentId: number; preview: { title: string } | null }[] };
		expect(data.cases).toHaveLength(1);
		expect(data.cases[0].preview).toMatchObject({ title: 'Fall' });
		await expect(
			queue({
				locals: { user: w.member.user },
				url: new URL('https://loki.test/moderation')
			} as never)
		).rejects.toMatchObject({ status: 403 });
	});

	it('the layout load takes the open-case count from the root layout and adds the admin flag', async () => {
		const w = await world();
		const parent = async () => ({ openCases: 1 });
		expect(await moderationLayout({ locals: { user: w.mod.user }, parent } as never)).toEqual({
			isAdmin: false,
			openCases: 1
		});
		expect(
			await moderationLayout({ locals: { user: w.admin.user }, parent } as never)
		).toMatchObject({ isAdmin: true });
	});

	it('log filter ignores unknown actions and cursor garbage', async () => {
		const w = await world();
		await setTimeout_(w.admin.user, w.victim.user.id, 2, 'x');
		const load = (query: string) =>
			log({
				locals: { user: w.mod.user },
				url: new URL(`https://loki.test/moderation/log${query}`)
			} as never) as Promise<{ entries: { action: string }[]; action: string }>;
		expect((await load('?action=timeout_set')).entries.map((e) => e.action)).toEqual([
			'timeout_set'
		]);
		expect((await load('?action=timeout_lifted')).entries).toHaveLength(0);
		const garbage = await load('?action=%27%20OR%201=1&cursor=abc');
		expect(garbage.action).toBe('');
		expect(garbage.entries).toHaveLength(1);
	});
});

describe('open-case badge in the root layout', () => {
	it('is null for members and anonymous, the count for moderators and admins', async () => {
		const w = await world();
		const load = (user: World['mod']['user'] | null) =>
			rootLayout({
				locals: { user },
				url: new URL('http://localhost/'),
				depends: () => {}
			} as never) as Promise<{
				openCases: number | null;
			}>;
		expect((await load(w.member.user)).openCases).toBeNull();
		expect((await load(null)).openCases).toBeNull();
		expect((await load(w.mod.user)).openCases).toBe(1);
		expect((await load(w.admin.user)).openCases).toBe(1);
	});

	it('is null for a timed-out moderator or admin (their moderation rights rest)', async () => {
		const w = await world();
		const load = (user: World['mod']['user']) =>
			rootLayout({
				locals: { user },
				url: new URL('http://localhost/'),
				depends: () => {}
			} as never) as Promise<{
				openCases: number | null;
			}>;
		expect((await load(w.lockedMod.user)).openCases).toBeNull();
		expect((await load(w.lockedAdmin.user)).openCases).toBeNull();
	});
});

describe('status data in the root layout', () => {
	it("depends on 'loki:status' so the client can refresh it", async () => {
		const depends = vi.fn();
		await rootLayout({
			locals: { user: null },
			url: new URL('http://localhost/'),
			depends
		} as never);
		expect(depends).toHaveBeenCalledWith('loki:status');
	});
});

describe('season data in the root layout', () => {
	type Layout = { season: { id: string } | null };

	it('returns the season resolved for the request, the preview for an admin', async () => {
		const w = await world();
		const url = new URL('http://localhost/?season=advent');
		const layout = (await rootLayout({
			locals: { user: w.admin.user, season: { id: 'advent', source: 'preview' } },
			url,
			depends: () => {}
		} as never)) as Layout;
		expect(layout.season?.id).toBe('advent');
	});

	it('reads the pathname and the season parameter, so kit re-runs it on every navigation', async () => {
		const url = new URL('http://localhost/?season=advent');
		const get = vi.spyOn(url.searchParams, 'get');
		await rootLayout({ locals: { user: null, season: null }, url, depends: () => {} } as never);
		expect(get).toHaveBeenCalledWith('season');
	});
});

describe('timeout banner data in the root layout', () => {
	type Layout = { activeTimeout: { until: string; reason: string } | null };
	const load = (user: World['mod']['user'] | null) =>
		rootLayout({
			locals: { user },
			url: new URL('http://localhost/'),
			depends: () => {}
		} as never) as Promise<Layout>;

	it('exposes the active timeout of a timed-out viewer', async () => {
		const w = await world();
		const { activeTimeout: t } = await load(w.lockedMod.user);
		expect(t?.reason).toBe('test');
		expect(new Date(t!.until).getTime()).toBeGreaterThan(Date.now());
	});

	it('is null for untimed users, anonymous visitors and lifted or expired timeouts', async () => {
		const w = await world();
		expect((await load(w.member.user)).activeTimeout).toBeNull();
		expect((await load(w.mod.user)).activeTimeout).toBeNull();
		expect((await load(null)).activeTimeout).toBeNull();
		await liftTimeout(w.admin.user, w.lockedMod.user.id);
		expect((await load(w.lockedMod.user)).activeTimeout).toBeNull();
		await db
			.update(timeouts)
			.set({ until: new Date(Date.now() - 1000) })
			.where(eq(timeouts.userId, w.lockedAdmin.user.id));
		expect((await load(w.lockedAdmin.user)).activeTimeout).toBeNull();
	});
});
