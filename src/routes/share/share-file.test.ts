import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { userWithSession } from '../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { putShared } from '../../lib/server/share-stash';
import { callRoute } from '../../lib/server/test-request';
import { GET } from './file/+server';

beforeAll(async () => {
	await setupDb();
});

beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

const png = { name: 'a.png', type: 'image/png', data: Buffer.from('x') };

describe('GET /share/file hand-over headers', () => {
	it('adds the title (URI-encoded) and the template id when present', async () => {
		const { user, session } = await userWithSession();
		putShared(user.id, { ...png, title: 'Montag, wieder ä', templateId: 7 });
		const { response } = await callRoute({ handler: GET, path: '/share/file', session });
		expect(response.status).toBe(200);
		const title = response.headers.get('x-shared-title')!;
		expect(title).not.toContain(' ');
		expect(decodeURIComponent(title)).toBe('Montag, wieder ä');
		expect(response.headers.get('x-shared-template')).toBe('7');
		expect(response.headers.get('x-shared-name')).toBe('a.png');
	});

	it('omits both headers when the stash has neither', async () => {
		const { user, session } = await userWithSession();
		putShared(user.id, png);
		const { response } = await callRoute({ handler: GET, path: '/share/file', session });
		expect(response.status).toBe(200);
		expect(response.headers.has('x-shared-title')).toBe(false);
		expect(response.headers.has('x-shared-template')).toBe(false);
	});
});
