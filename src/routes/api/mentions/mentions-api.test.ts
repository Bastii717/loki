import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb, testUser } from '../../../lib/server/db/test-utils';
import { userWithSession } from '../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../lib/server/rate-limit';
import { callRoute } from '../../../lib/server/test-request';
import { GET } from './+server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

const search = (q: string, session: string) =>
	callRoute({
		handler: GET,
		path: `/api/mentions?q=${encodeURIComponent(q)}`,
		session
	});

describe('GET /api/mentions', () => {
	it('matches the display name and returns id, name and avatar only', async () => {
		const me = await userWithSession('member');
		const lena = await testUser({
			username: 'lk_secret',
			displayName: 'Lena Kowalski',
			displayNameKey: 'lena kowalski',
			avatarThumbKey: 'avatars/l.webp',
			role: 'moderator'
		});
		const { response } = await search('Lena', me.session);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.people).toEqual([
			{ id: lena.publicId, name: 'Lena Kowalski', avatarThumbKey: 'avatars/l.webp' }
		]);
		expect(JSON.stringify(body)).not.toContain('lk_secret');
	});

	it('returns at most 8 people and nothing for an empty or too long query', async () => {
		const me = await userWithSession('member');
		for (let i = 0; i < 10; i++) {
			await testUser({ displayName: `Anna ${i}`, displayNameKey: `anna ${i}` });
		}
		const { response } = await search('Anna', me.session);
		expect((await response.json()).people).toHaveLength(8);
		expect(await (await search('', me.session)).response.json()).toEqual({ people: [] });
		expect((await search('x'.repeat(51), me.session)).response.status).toBe(400);
	});
});
