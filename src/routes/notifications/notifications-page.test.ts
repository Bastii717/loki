import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../lib/server/db';
import { notifications } from '../../lib/server/db/schema';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import {
	insertMemeRow,
	insertQuote,
	userWithSession
} from '../../lib/server/moderation-test-utils';
import { countUnread } from '../../lib/server/notifications';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { callRoute } from '../../lib/server/test-request';
import { actions as maintenanceActions } from '../moderation/maintenance/+page.server';
import { actions, load } from './+page.server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

type Member = Awaited<ReturnType<typeof userWithSession>>;
type Row = typeof notifications.$inferInsert;

async function seed(userId: number, over: Partial<Row> = {}): Promise<number> {
	const [row] = await db
		.insert(notifications)
		.values({ userId, kind: 'comment', ...over })
		.returning({ id: notifications.id });
	return row.id;
}

/** The page load for `member`, called directly (callRoute only returns Responses). */
const loadFor = (member: Member, query = '') =>
	load({
		locals: { user: member.user },
		url: new URL(`https://loki.test/notifications${query}`),
		// the root layout supplies the bell count
		parent: async () => ({ unreadNotifications: await countUnread(member.user.id) })
	} as never) as Promise<{
		items: { id: number; kind: string; mediaId: string | null }[];
		hasMore: boolean;
		filter: string;
		unread: number;
	}>;

const open = (member: Member, id: string, filter?: string) =>
	callRoute({
		handler: actions.open,
		path: '/notifications?/open',
		method: 'POST',
		session: member.session,
		form: filter === undefined ? { id } : { id, filter }
	});

async function lockWrites() {
	const admin = await userWithSession('admin');
	const res = await callRoute({
		handler: maintenanceActions.save,
		path: '/moderation/maintenance?/save',
		method: 'POST',
		session: admin.session,
		form: { enabled: 'on', message: '', startsAt: '', until: '' }
	});
	// an action's plain result reaches callRoute as an empty 204
	expect(res.response.status).toBe(204);
}

describe('notifications page load', () => {
	it('sends an anonymous request to the login page', async () => {
		const res = await callRoute({ handler: load, path: '/notifications' });
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe('/login');
	});

	it('lists every kind by default with the unread count', async () => {
		const member = await userWithSession();
		const a = await seed(member.user.id, { kind: 'comment' });
		const b = await seed(member.user.id, { kind: 'timeout_lifted' });
		await seed(member.user.id, { kind: 'comment', readAt: new Date() });
		const data = await loadFor(member);
		expect(data.filter).toBe('all');
		expect(data.hasMore).toBe(false);
		expect(data.unread).toBe(2);
		expect(data.items).toHaveLength(3);
		expect(data.items.map((i) => i.id)).toContain(a);
		expect(data.items.map((i) => i.id)).toContain(b);
	});

	it('carries the meme public id and no numeric mediaId in the page data', async () => {
		const member = await userWithSession();
		const { id: memeId, publicId } = await insertMemeRow(member.user.id);
		await seed(member.user.id, { mediaId: memeId });
		const data = await loadFor(member);
		expect(data.items[0]).toMatchObject({ mediaId: publicId });
		// notification ids are plain row ids; the meme reference must be the public id
		expect(JSON.stringify(data)).not.toMatch(/"mediaId":\d/);
	});

	it('only shows the signed-in member their own notices', async () => {
		const member = await userWithSession();
		const other = await userWithSession();
		await seed(other.user.id);
		const data = await loadFor(member);
		expect(data.items).toEqual([]);
		expect(data.unread).toBe(0);
	});

	it('filters by category', async () => {
		const member = await userWithSession();
		await seed(member.user.id, { kind: 'comment' });
		await seed(member.user.id, { kind: 'timeout_lifted' });
		const moderation = await loadFor(member, '?filter=moderation');
		expect(moderation.filter).toBe('moderation');
		expect(moderation.items.map((i) => i.kind)).toEqual(['timeout_lifted']);
		const activity = await loadFor(member, '?filter=activity');
		expect(activity.filter).toBe('activity');
		expect(activity.items.map((i) => i.kind)).toEqual(['comment']);
		// unread stays the total, not the filtered count
		expect(activity.unread).toBe(2);
	});

	it('treats an unknown filter as all', async () => {
		const member = await userWithSession();
		await seed(member.user.id);
		const data = await loadFor(member, '?filter=nonsense');
		expect(data.filter).toBe('all');
		expect(data.items).toHaveLength(1);
	});

	it('pages with ?before and ignores a malformed one', async () => {
		const member = await userWithSession();
		const ids: number[] = [];
		for (let i = 0; i < 52; i++) {
			ids.push(await seed(member.user.id, { updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }));
		}
		const first = await loadFor(member);
		expect(first.items).toHaveLength(50);
		expect(first.hasMore).toBe(true);
		const last = first.items[49].id;
		const second = await loadFor(member, `?before=${last}`);
		expect(second.items.map((i) => i.id)).toEqual([ids[1], ids[0]]);
		expect(second.hasMore).toBe(false);
		for (const bad of ['abc', '-3', '0', '1.5', '99999999999']) {
			expect((await loadFor(member, `?before=${bad}`)).items).toHaveLength(50);
		}
	});
});

describe('open action', () => {
	it('marks the notice read and goes to the meme', async () => {
		const member = await userWithSession();
		const { id: memeId, publicId } = await insertMemeRow(member.user.id);
		const id = await seed(member.user.id, { mediaId: memeId });
		const res = await open(member, String(id));
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe(`/meme/${publicId}`);
		expect(await countUnread(member.user.id)).toBe(0);
	});

	it('goes to the profile editor for a profile notice', async () => {
		const member = await userWithSession();
		const id = await seed(member.user.id, { kind: 'avatar_removed' });
		const res = await open(member, String(id));
		expect(res.response.headers.get('location')).toBe('/profile/edit');
	});

	it('goes to the rules for a timeout', async () => {
		const member = await userWithSession();
		const id = await seed(member.user.id, { kind: 'timeout_set' });
		const res = await open(member, String(id));
		expect(res.response.headers.get('location')).toBe('/rules');
	});

	it('goes to the quotes for a quote notice', async () => {
		const member = await userWithSession();
		const quoteId = await insertQuote(member.user.id);
		const id = await seed(member.user.id, {
			kind: 'content_deleted',
			contentType: 'quote',
			contentId: quoteId
		});
		const res = await open(member, String(id));
		expect(res.response.headers.get('location')).toBe('/quotes');
	});

	it('stays on the page when the notice has nowhere to lead', async () => {
		const member = await userWithSession();
		const id = await seed(member.user.id, { kind: 'timeout_lifted' });
		const res = await open(member, String(id));
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe('/notifications');
		expect(await countUnread(member.user.id)).toBe(0);
	});

	it('redirects back for an unknown id without marking anything', async () => {
		const member = await userWithSession();
		await seed(member.user.id);
		const res = await open(member, '999999');
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe('/notifications');
		expect(await countUnread(member.user.id)).toBe(1);
	});

	it('keeps the filter when the target is gone, and drops an unknown one', async () => {
		const member = await userWithSession();
		const id = await seed(member.user.id, { kind: 'timeout_lifted' });
		for (const filter of ['activity', 'moderation']) {
			const res = await open(member, String(id), filter);
			expect(res.response.headers.get('location')).toBe(`/notifications?filter=${filter}`);
		}
		for (const filter of ['all', 'nonsense', '']) {
			const res = await open(member, String(id), filter);
			expect(res.response.headers.get('location')).toBe('/notifications');
		}
		const unknown = await open(member, '999999', 'moderation');
		expect(unknown.response.headers.get('location')).toBe('/notifications?filter=moderation');
	});

	it('still goes to the target when a filter is sent', async () => {
		const member = await userWithSession();
		const { id: memeId, publicId } = await insertMemeRow(member.user.id);
		const id = await seed(member.user.id, { mediaId: memeId });
		const res = await open(member, String(id), 'activity');
		expect(res.response.headers.get('location')).toBe(`/meme/${publicId}`);
	});

	it('does not open or mark a notice of someone else', async () => {
		const member = await userWithSession();
		const other = await userWithSession();
		const { id: memeId } = await insertMemeRow(other.user.id);
		const id = await seed(other.user.id, { mediaId: memeId });
		const res = await open(member, String(id));
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe('/notifications');
		expect(await countUnread(other.user.id)).toBe(1);
	});

	it('redirects back for a malformed id', async () => {
		const member = await userWithSession();
		await seed(member.user.id);
		for (const bad of ['', 'abc', '1.5', '-1', '99999999999']) {
			const res = await open(member, bad);
			expect(res.response.status).toBe(303);
			expect(res.response.headers.get('location')).toBe('/notifications');
		}
		expect(await countUnread(member.user.id)).toBe(1);
	});

	it('keeps working while writes are locked for maintenance', async () => {
		const member = await userWithSession();
		const { id: memeId, publicId } = await insertMemeRow(member.user.id);
		const id = await seed(member.user.id, { mediaId: memeId });
		await lockWrites();
		const res = await open(member, String(id));
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe(`/meme/${publicId}`);
		expect(await countUnread(member.user.id)).toBe(0);
	});
});

describe('readAll action', () => {
	it('marks every notice of the member read and nobody elses', async () => {
		const member = await userWithSession();
		const other = await userWithSession();
		await seed(member.user.id);
		await seed(member.user.id, { kind: 'timeout_lifted' });
		await seed(other.user.id);
		const res = await callRoute({
			handler: actions.readAll,
			path: '/notifications?/readAll',
			method: 'POST',
			session: member.session,
			form: {}
		});
		expect(res.response.status).toBe(204);
		expect(await countUnread(member.user.id)).toBe(0);
		expect(await countUnread(other.user.id)).toBe(1);
	});

	it('returns done', async () => {
		const member = await userWithSession();
		const result = await actions.readAll({ locals: { user: member.user } } as never);
		expect(result).toEqual({ done: true });
	});
});

describe('actions', () => {
	it('exposes exactly open and readAll', () => {
		expect(Object.keys(actions).sort()).toEqual(['open', 'readAll']);
	});
});
