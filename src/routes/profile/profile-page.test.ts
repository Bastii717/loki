import { render } from 'svelte/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../lib/server/db';
import { awards } from '../../lib/server/db/schema';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { userWithSession } from '../../lib/server/moderation-test-utils';
import { setDisplayName, setMotto } from '../../lib/server/profile';
import { load } from './+page.server';
import Page from './+page.svelte';

beforeAll(setupDb);
beforeEach(resetDb);

type LoadData = {
	profile: Record<string, unknown>;
	counts: { memes: number; favorites: number; comments: number };
	awards: { month: string }[];
};

describe('profile load', () => {
	it('returns the display name, username, motto, avatar keys and cooldown', async () => {
		const { user } = await userWithSession();
		await setDisplayName(user, user.id, 'Lena K');
		await setMotto(user, 'Memes first');
		const data = (await load({ locals: { user } } as never)) as LoadData;
		expect(data.profile).toEqual({
			username: user.username,
			displayName: 'Lena K',
			motto: 'Memes first',
			avatarKey: null,
			avatarThumbKey: null,
			role: 'member'
		});
		expect(data.counts).toEqual({ memes: 0, favorites: 0, comments: 0 });
		expect(data.awards).toEqual([]);
	});

	it('carries no internal id: no numeric id, user id or public id of the viewer', async () => {
		const { user, publicId } = await userWithSession();
		const data = await load({ locals: { user } } as never);
		const json = JSON.stringify(data);
		expect(json).not.toMatch(/"(id|userId|uploaderId)":\d/);
		expect(json).not.toContain(publicId);
	});

	it('lists the months the member won, newest first', async () => {
		const { user } = await userWithSession();
		const other = await userWithSession();
		const win = (month: string, uploaderId: number) =>
			db.insert(awards).values({ month: `${month}-01`, uploaderId, title: 'T', score: 3 });
		await win('2026-08', user.id);
		await win('2026-10', user.id);
		await win('2026-09', other.user.id);
		const data = (await load({ locals: { user } } as never)) as LoadData;
		expect(data.awards).toEqual([{ month: '2026-10' }, { month: '2026-08' }]);
	});
});

const pageData = (over: Record<string, unknown> = {}) => ({
	profile: {
		username: 'user1',
		displayName: null,
		motto: '',
		avatarKey: null,
		avatarThumbKey: null,
		role: 'member'
	},
	counts: { memes: 0, favorites: 0, comments: 0 },
	awards: [],
	openCases: null,
	...over
});

describe('profile page', () => {
	it('links to the awards page right after Stats', () => {
		const { body } = render(Page as never, { props: { data: pageData() } as never });
		const hrefs = [...body.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs.indexOf('/awards')).toBe(hrefs.indexOf('/profile/stats') + 1);
		expect(body).toMatch(/<a href="\/awards"[^>]*>[\s\S]*?lucide-trophy[\s\S]*?Awards/);
	});

	it('shows the awards count after Comments, without chips when there are none', () => {
		const { body } = render(Page as never, { props: { data: pageData() } as never });
		expect(body).toMatch(/<dt[^>]*>Comments<\/dt>[\s\S]*<dt[^>]*>Awards<\/dt>\s*<dd[^>]*>0<\/dd>/);
		expect(body).not.toContain('Meme of the Month, ');
	});

	it('shows a chip per award linking to its month on the awards page', () => {
		const { body } = render(Page as never, {
			props: { data: pageData({ awards: [{ month: '2026-10' }, { month: '2026-08' }] }) } as never
		});
		expect(body).toMatch(/<dt[^>]*>Awards<\/dt>\s*<dd[^>]*>2<\/dd>/);
		expect(body).toMatch(
			/<a[^>]*class="chip[^"]*"[^>]*href="\/awards\?from=2026-10#2026-10"[^>]*>[\s\S]*?lucide-trophy[\s\S]*?Oct 2026/
		);
		expect(body).toMatch(/href="\/awards\?from=2026-08#2026-08"[^>]*>[\s\S]*?Aug 2026/);
	});

	it('links to the notification preferences right after Edit profile', () => {
		const { body } = render(Page as never, { props: { data: pageData() } as never });
		const hrefs = [...body.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs.indexOf('/profile/notifications')).toBe(hrefs.indexOf('/profile/edit') + 1);
		expect(body).toMatch(
			/<a href="\/profile\/notifications"[^>]*>[\s\S]*?lucide-bell[\s\S]*?Notifications/
		);
	});
});
