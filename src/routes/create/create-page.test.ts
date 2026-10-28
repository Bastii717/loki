import { isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../lib/server/db';
import { media, templates } from '../../lib/server/db/schema';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertMeme,
	OVER_THRESHOLD,
	userWithSession
} from '../../lib/server/moderation-test-utils';
import { env } from '../../lib/server/env';
import { resetRateLimits } from '../../lib/server/rate-limit';
import { peekShared, takeShared } from '../../lib/server/share-stash';
import { deleteObjects } from '../../lib/server/storage';
import { ensureBucket } from '../../lib/server/storage-test-utils';
import { callRoute } from '../../lib/server/test-request';
import { addTemplate, removeTemplate } from '../../lib/server/templates';
import { actions, load, type CreateData } from './+page.server';

type Member = Awaited<ReturnType<typeof userWithSession>>;

const created: string[] = [];
let png: Buffer;
let admin: Member;

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	png = await sharp({ create: { width: 300, height: 500, channels: 3, background: '#0a0' } })
		.png()
		.toBuffer();
});

beforeEach(async () => {
	await resetDb();
	admin = await userWithSession('admin');
});

afterAll(async () => {
	if (created.length) await deleteObjects(created);
});

async function template(name: string): Promise<number> {
	const { id } = await addTemplate(admin.user, name, png);
	const [row] = await db.select().from(templates).where(eq(templates.id, id));
	created.push(row.objectKey, row.thumbKey);
	return id;
}

/** The page load for `member`, called directly (callRoute only returns Responses). */
const loadFor = (member: Member, query = '') =>
	load({
		locals: { user: member.user },
		url: new URL(`https://loki.test/create${query}`)
	} as never) as Promise<CreateData>;

const status = async (member: Member, query: string) =>
	(await callRoute({ handler: load, path: `/create${query}`, session: member.session })).response;

describe('create page load', () => {
	it('sends an anonymous request to the login page', async () => {
		const res = await callRoute({ handler: load, path: '/create' });
		expect(res.response.status).toBe(303);
		expect(res.response.headers.get('location')).toBe('/login');
	});

	it('lists the active templates by usage, then name', async () => {
		const alpha = await template('Alpha');
		const beta = await template('Beta');
		const author = await userWithSession();
		const meme = await insertMeme(author.user.id);
		await db.update(media).set({ templateId: beta }).where(eq(media.id, meme));

		const data = await loadFor(author);
		expect(data.mode).toBe('grid');
		if (data.mode !== 'grid') return;
		expect(data.templates.map((t) => t.id)).toEqual([beta, alpha]);
	});

	it('returns an empty grid without templates', async () => {
		const member = await userWithSession();
		expect(await loadFor(member)).toEqual({ mode: 'grid', templates: [] });
	});

	it('opens a template as the editor source', async () => {
		const id = await template('Drake');
		const member = await userWithSession();
		expect(await loadFor(member, `?template=${id}`)).toEqual({
			mode: 'template',
			source: {
				kind: 'template',
				id,
				name: 'Drake',
				width: 300,
				height: 500,
				url: `/api/templates/${id}/image`
			}
		});
	});

	it('answers 404 for an unknown or removed template', async () => {
		const member = await userWithSession();
		const res = await status(member, '?template=999999');
		expect(res.status).toBe(404);
		expect(await res.text()).toBe('Template not found.');

		const id = await template('Gone');
		await removeTemplate(admin.user, id);
		expect((await status(member, `?template=${id}`)).status).toBe(404);
	});

	it('opens an image meme as the editor source', async () => {
		const member = await userWithSession();
		const id = await insertMeme(member.user.id, 'Monday cat');
		await db.update(media).set({ width: 640, height: 480 }).where(eq(media.id, id));
		expect(await loadFor(member, `?meme=${id}`)).toEqual({
			mode: 'meme',
			source: {
				kind: 'meme',
				id,
				name: 'Monday cat',
				width: 640,
				height: 480,
				url: `/api/memes/${id}/source`
			}
		});
	});

	it('falls back to 1200 x 900 and "Untitled" for a meme without size or title', async () => {
		const member = await userWithSession();
		const id = await insertMeme(member.user.id, '');
		const data = await loadFor(member, `?meme=${id}`);
		expect(data).toMatchObject({
			mode: 'meme',
			source: { name: 'Untitled', width: 1200, height: 900 }
		});
	});

	it('answers 404 for a gif or a missing meme', async () => {
		const member = await userWithSession();
		const id = await insertMeme(member.user.id);
		await db.update(media).set({ kind: 'gif' }).where(eq(media.id, id));
		const res = await status(member, `?meme=${id}`);
		expect(res.status).toBe(404);
		expect(await res.text()).toBe('Meme not found.');
		expect((await status(member, '?meme=999999')).status).toBe(404);
	});

	it('hides a meme under review from members but not from moderators', async () => {
		const author = await userWithSession();
		const id = await insertMeme(author.user.id);
		await addOpenReports('meme', id, author.user.id, OVER_THRESHOLD);

		const member = await userWithSession();
		expect((await status(member, `?meme=${id}`)).status).toBe(404);

		const moderator = await userWithSession('moderator');
		expect(await loadFor(moderator, `?meme=${id}`)).toMatchObject({
			mode: 'meme',
			source: { id }
		});
		expect((await status(moderator, `?meme=${id}`)).status).toBe(204);
	});

	it('ignores a malformed id and shows the grid', async () => {
		const member = await userWithSession();
		expect((await loadFor(member, '?template=abc&meme=-3')).mode).toBe('grid');
	});
});

describe('create page actions', () => {
	it('has only the stash action', () => {
		expect(Object.keys(actions)).toEqual(['stash']);
	});

	const stash = async (member: Member, fields: Record<string, string | File>) => {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
		const event = {
			request: new Request('https://loki.test/create?/stash', { method: 'POST', body }),
			locals: { user: member.user }
		};
		try {
			return (await (actions.stash as (e: never) => unknown)(event as never)) as {
				status: number;
				data: { error: string };
			};
		} catch (e) {
			if (isRedirect(e)) return e;
			throw e;
		}
	};

	const pngFile = (data = png) =>
		new File([new Uint8Array(data)], 'meme.png', { type: 'image/png' });

	beforeEach(() => resetRateLimits());

	it('stashes the PNG with title and template, then redirects to the upload form', async () => {
		const id = await template('Drake');
		const member = await userWithSession();
		const res = await stash(member, {
			file: pngFile(),
			title: '  Monday  ',
			templateId: String(id)
		});
		expect(res).toMatchObject({ status: 303, location: '/upload?shared=1' });
		const shared = takeShared(member.user.id);
		expect(shared).toMatchObject({
			name: 'meme.png',
			type: 'image/png',
			title: 'Monday',
			templateId: id
		});
		expect(shared!.data.equals(png)).toBe(true);
		expect(await db.select().from(media)).toHaveLength(0);
	});

	it('drops an unknown, removed or malformed template id and still stashes', async () => {
		const gone = await template('Gone');
		await removeTemplate(admin.user, gone);
		const member = await userWithSession();
		for (const templateId of ['999999', String(gone), 'abc', '-1', '0', '2147483648', '']) {
			const res = await stash(member, { file: pngFile(), templateId });
			expect(res, templateId).toMatchObject({ status: 303 });
			const shared = takeShared(member.user.id);
			expect(shared, templateId).not.toBeNull();
			expect(shared!.templateId, templateId).toBeUndefined();
		}
	});

	it('rejects a JPEG with 415', async () => {
		const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#f00' } })
			.jpeg()
			.toBuffer();
		const member = await userWithSession();
		const res = await stash(member, { file: new File([new Uint8Array(jpeg)], 'meme.png') });
		expect(res).toMatchObject({ status: 415, data: { error: 'Unsupported file type' } });
		expect(peekShared(member.user.id)).toBeNull();
	});

	it('rejects an empty or missing file with 400', async () => {
		const member = await userWithSession();
		const cases: Record<string, string | File>[] = [
			{ file: new File([], 'meme.png') },
			{ title: 'x' }
		];
		for (const fields of cases) {
			const res = await stash(member, fields);
			expect(res).toMatchObject({ status: 400, data: { error: 'Nothing to post yet.' } });
		}
		expect(peekShared(member.user.id)).toBeNull();
	});

	it('rejects a file over MAX_UPLOAD_MB with 413', async () => {
		const member = await userWithSession();
		const big = Buffer.concat([png, Buffer.alloc(env.MAX_UPLOAD_MB * 1024 * 1024)]);
		const res = await stash(member, { file: pngFile(big) });
		expect(res).toMatchObject({
			status: 413,
			data: { error: `File is too large (max ${env.MAX_UPLOAD_MB} MB)` }
		});
		expect(peekShared(member.user.id)).toBeNull();
	});

	it('shares the upload budget: the eleventh POST in five minutes is 429', async () => {
		const member = await userWithSession();
		const post = () =>
			callRoute({
				handler: actions.stash as never,
				path: '/create',
				method: 'POST',
				form: { title: 'x' },
				session: member.session
			});
		for (let i = 0; i < 10; i++) expect((await post()).response.status).not.toBe(429);
		const res = (await post()).response;
		expect(res.status).toBe(429);
		expect(await res.text()).toContain('Slow down, Lord! Too many requests.');
	});
});
