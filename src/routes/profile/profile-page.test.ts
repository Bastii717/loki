import { render } from 'svelte/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
	});
});

describe('profile page', () => {
	it('links to the notification preferences right after Edit profile', () => {
		const { body } = render(Page as never, {
			props: {
				data: {
					profile: {
						username: 'user1',
						displayName: null,
						motto: '',
						avatarKey: null,
						avatarThumbKey: null,
						role: 'member'
					},
					counts: { memes: 0, favorites: 0, comments: 0 },
					openCases: null
				}
			} as never
		});
		const hrefs = [...body.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs.indexOf('/profile/notifications')).toBe(hrefs.indexOf('/profile/edit') + 1);
		expect(body).toMatch(
			/<a href="\/profile\/notifications"[^>]*>[\s\S]*?lucide-bell[\s\S]*?Notifications/
		);
	});
});
