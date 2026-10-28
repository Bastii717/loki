import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import { awards, users } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertMeme,
	OVER_THRESHOLD,
	userWithSession
} from '../../../lib/server/moderation-test-utils';
import { callRoute } from '../../../lib/server/test-request';
import { eq } from 'drizzle-orm';
import type { FeedItem } from '../../../lib/server/feed';
import { load } from './+page.server';

beforeAll(setupDb);
beforeEach(resetDb);

type Member = Awaited<ReturnType<typeof userWithSession>>;
interface Data {
	member: {
		id: string;
		name: string;
		username: string | null;
		role: string;
		avatarKey: string | null;
		avatarThumbKey: string | null;
		motto: string;
		memberSince: string;
	};
	memeCount: number;
	awards: { month: string }[];
	items: FeedItem[];
	nextCursor: string | null;
}

/** The page load for `viewer` looking at member `pid`, called directly (callRoute only returns Responses). */
const loadFor = (viewer: Member, pid: string) =>
	load({ locals: { user: viewer.user }, params: { pid } } as never) as Promise<Data>;

async function world() {
	const [viewer, mod, target, other] = await Promise.all([
		userWithSession('member'),
		userWithSession('moderator'),
		userWithSession('member'),
		userWithSession('member')
	]);
	await db
		.update(users)
		.set({
			displayName: 'Hanna Lee',
			motto: 'Ship it',
			createdAt: new Date('2026-10-12T10:00:00Z')
		})
		.where(eq(users.id, target.user.id));
	const first = await insertMeme(target.user.id, 'first');
	const second = await insertMeme(target.user.id, 'second');
	const hidden = await insertMeme(target.user.id, 'hidden');
	const foreign = await insertMeme(other.user.id, 'foreign');
	await addOpenReports('meme', hidden, target.user.id, OVER_THRESHOLD);
	return { viewer, mod, target, other, first, second, hidden, foreign };
}

describe('member page load', () => {
	it('sends an anonymous request to the login page', async () => {
		const res = await callRoute({
			handler: load,
			path: '/users/1',
			params: { pid: '1' }
		});
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toContain('/login');
	});

	it.each(['abc', '1', '0', '-2', '1.5', '', 'abcdefghijk', 'abcdefghijklm', 'abcdefghij-l'])(
		'404s an invalid id %j',
		async (pid) => {
			const w = await world();
			await expect(loadFor(w.viewer, pid)).rejects.toMatchObject({
				status: 404,
				body: { message: 'No such member.' }
			});
		}
	);

	it('404s the internal numeric id of an existing member', async () => {
		const w = await world();
		await expect(loadFor(w.viewer, String(w.target.user.id))).rejects.toMatchObject({
			status: 404
		});
	});

	it('404s an unknown member', async () => {
		const w = await world();
		await expect(loadFor(w.viewer, 'AAAAAAAAAAAA')).rejects.toMatchObject({
			status: 404,
			body: { message: 'No such member.' }
		});
	});

	it('returns the member, hides the username from members and lists only their memes', async () => {
		const w = await world();
		const data = await loadFor(w.viewer, w.target.publicId);
		expect(data.member).toEqual({
			id: w.target.publicId,
			name: 'Hanna Lee',
			username: null,
			role: 'member',
			avatarKey: null,
			avatarThumbKey: null,
			motto: 'Ship it',
			memberSince: '2026-10-12T10:00:00.000Z'
		});
		// compared by title: the item ids themselves are the feed's concern (public ids)
		expect(data.items.map((i) => i.title)).toEqual(['second', 'first']);
		expect(data.nextCursor).toBeNull();
	});

	it('counts and lists without the hidden meme for a member (no placeholder)', async () => {
		const w = await world();
		const data = await loadFor(w.viewer, w.target.publicId);
		expect(data.memeCount).toBe(2);
		expect(data.items.map((i) => i.title)).not.toContain('hidden');
		expect(JSON.stringify(data)).not.toContain('hidden');
	});

	it('includes the hidden meme in count and list, and the username, for a moderator', async () => {
		const w = await world();
		const data = await loadFor(w.mod, w.target.publicId);
		expect(data.memeCount).toBe(3);
		expect(data.items.map((i) => i.title)).toContain('hidden');
		expect(data.member.username).toBe(w.target.user.username);
	});

	it('uses the username as the name when no display name is set', async () => {
		const w = await world();
		const data = await loadFor(w.viewer, w.other.publicId);
		expect(data.member.name).toBe(w.other.user.username);
		expect(data.memeCount).toBe(1);
	});

	it('renders the own id like any other', async () => {
		const w = await world();
		const data = await loadFor(w.target, w.target.publicId);
		expect(data.member.id).toBe(w.target.publicId);
		// the viewer's own hidden meme is still hidden from them, like in every feed
		expect(data.memeCount).toBe(2);
	});

	it('exposes the public id and no internal id in the payload', async () => {
		const w = await world();
		const data = await loadFor(w.viewer, w.target.publicId);
		expect(data.member.id).toMatch(/^[A-Za-z0-9]{12}$/);
		const json = JSON.stringify({ member: data.member, awards: data.awards });
		expect(json).not.toMatch(/"(id|userId|uploaderId)":\d/);
	});

	it("returns the months the member won, newest first, and not another member's", async () => {
		const w = await world();
		const win = (month: string, uploaderId: number) =>
			db.insert(awards).values({ month: `${month}-01`, uploaderId, title: 'T', score: 3 });
		await win('2026-08', w.target.user.id);
		await win('2026-10', w.target.user.id);
		await win('2026-09', w.other.user.id);
		const data = await loadFor(w.viewer, w.target.publicId);
		expect(data.awards).toEqual([{ month: '2026-10' }, { month: '2026-08' }]);
		expect((await loadFor(w.viewer, w.mod.publicId)).awards).toEqual([]);
	});

	it('shows an empty list for a member without memes', async () => {
		const w = await world();
		const data = await loadFor(w.viewer, w.mod.publicId);
		expect(data.items).toEqual([]);
		expect(data.memeCount).toBe(0);
	});
});
