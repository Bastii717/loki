import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { userWithSession } from '../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { putShared, stashSharedFile } from '../../lib/server/share-stash';
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

describe('GET /share/file source flag headers', () => {
	it('adds x-shared-nsfw and x-shared-spoiler only when true', async () => {
		const { user, session } = await userWithSession();
		putShared(user.id, { ...png, nsfw: true });
		const nsfw = (await callRoute({ handler: GET, path: '/share/file', session })).response;
		expect(nsfw.headers.get('x-shared-nsfw')).toBe('1');
		expect(nsfw.headers.has('x-shared-spoiler')).toBe(false);

		putShared(user.id, { ...png, spoiler: true, nsfw: false });
		const spoiler = (await callRoute({ handler: GET, path: '/share/file', session })).response;
		expect(spoiler.headers.has('x-shared-nsfw')).toBe(false);
		expect(spoiler.headers.get('x-shared-spoiler')).toBe('1');
	});

	it('omits both headers without flags', async () => {
		const { user, session } = await userWithSession();
		putShared(user.id, png);
		const { response } = await callRoute({ handler: GET, path: '/share/file', session });
		expect(response.headers.has('x-shared-nsfw')).toBe(false);
		expect(response.headers.has('x-shared-spoiler')).toBe(false);
	});

	it('round-trips the flags through stashSharedFile', async () => {
		const { user, session } = await userWithSession();
		const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
			.png()
			.toBuffer();
		await stashSharedFile(user.id, { name: 'a.png', data, nsfw: true, spoiler: true });
		const { response } = await callRoute({ handler: GET, path: '/share/file', session });
		expect(response.headers.get('x-shared-nsfw')).toBe('1');
		expect(response.headers.get('x-shared-spoiler')).toBe('1');
	});
});

describe('GET /share/file with a malformed stored title', () => {
	it('still answers with a decodable x-shared-title', async () => {
		const { user, session } = await userWithSession();
		// a lone high surrogate, as a UTF-16 slice through an emoji would leave
		putShared(user.id, { ...png, title: `${'a'.repeat(119)}\ud83d` });
		const { response } = await callRoute({ handler: GET, path: '/share/file', session });
		expect(response.status).toBe(200);
		const decoded = decodeURIComponent(response.headers.get('x-shared-title')!);
		expect(decoded.isWellFormed()).toBe(true);
		expect(decoded.startsWith('a'.repeat(119))).toBe(true);
	});

	it('keeps an emoji that fits intact through stash and response', async () => {
		const { user, session } = await userWithSession();
		const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
			.png()
			.toBuffer();
		expect(
			await stashSharedFile(user.id, { name: 'a.png', data, title: `${'a'.repeat(119)}😀tail` })
		).toBe(true);
		const { response } = await callRoute({ handler: GET, path: '/share/file', session });
		expect(decodeURIComponent(response.headers.get('x-shared-title')!)).toBe(
			`${'a'.repeat(119)}😀`
		);
	});
});
