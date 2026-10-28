import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import { auditLog, media, templates } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { env } from '../../../lib/server/env';
import { insertMeme, userWithSession } from '../../../lib/server/moderation-test-utils';
import { deleteObjects } from '../../../lib/server/storage';
import { ensureBucket } from '../../../lib/server/storage-test-utils';
import { callRoute } from '../../../lib/server/test-request';
import { actions, load } from './+page.server';

type Session = Awaited<ReturnType<typeof userWithSession>>;
type Result = { ok: true } | { status: number; data: { error: string } };
type LoadData = {
	templates: { id: number; name: string; usageCount: number }[];
	removed: { id: number; name: string }[];
};

const NOT_FOUND = { status: 404, data: { error: 'Template not found.' } };

const created: string[] = [];
let png: Buffer;
let admin: Session;

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#0a0' } })
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

const post = (body: FormData) =>
	new Request('https://loki.test/moderation/templates', { method: 'POST', body });

const fields = (values: Record<string, string>) => {
	const body = new FormData();
	for (const [key, value] of Object.entries(values)) body.set(key, value);
	return body;
};

/** Calls `add` directly: it is multipart, so a FormData request stands in for the browser. */
async function add(session: Session, name: string | null, file?: Buffer | '') {
	const body = new FormData();
	if (name !== null) body.set('name', name);
	if (file !== undefined) {
		body.set(
			'file',
			file === ''
				? new File([], '')
				: new File([new Uint8Array(file)], 'meme.png', { type: 'image/png' })
		);
	}
	const result = (await actions.add({
		request: post(body),
		locals: { user: session.user }
	} as never)) as Result;
	for (const t of await db.select().from(templates)) created.push(t.objectKey, t.thumbKey);
	return result;
}

/** A rename/remove/restore action called directly, so the returned value stays visible. */
const run = (
	name: 'rename' | 'remove' | 'restore',
	session: Session,
	values: Record<string, string>
) =>
	actions[name]({
		request: post(fields(values)),
		locals: { user: session.user }
	} as never) as Promise<Result>;

async function seed(name = 'Drake') {
	expect(await add(admin, name, png)).toEqual({ ok: true });
	const [row] = await db.select().from(templates).where(eq(templates.name, name));
	return row;
}

const rowOf = async (id: number) =>
	(await db.select().from(templates).where(eq(templates.id, id)))[0];

const audits = async (action: string) =>
	(await db.select().from(auditLog)).filter((a) => a.action === action);

describe('actions', () => {
	it('only exposes the four named actions', () => {
		expect(Object.keys(actions).sort()).toEqual(['add', 'remove', 'rename', 'restore']);
	});
});

describe('access', () => {
	it.each([
		['member', 'This area is for moderators and admins only'],
		['moderator', 'This area is for admins only']
	] as const)('refuses a %s on load and on every action', async (role, message) => {
		const other = await userWithSession(role);
		const handlers = [
			['load', load],
			['add', actions.add],
			['rename', actions.rename],
			['remove', actions.remove],
			['restore', actions.restore]
		] as const;
		for (const [name, handler] of handlers) {
			const { response } = await callRoute({
				handler,
				path: `/moderation/templates${name === 'load' ? '' : `?/${name}`}`,
				method: name === 'load' ? 'GET' : 'POST',
				session: other.session,
				form: name === 'load' ? undefined : { id: '1', name: 'x' }
			});
			expect(response.status, name).toBe(403);
			expect(await response.text(), name).toContain(message);
		}
	});

	it('turns anonymous requests away', async () => {
		const { response } = await callRoute({ handler: load, path: '/moderation/templates' });
		expect(response.status).toBe(303);
	});

	it('lets admins in', async () => {
		const { response } = await callRoute({
			handler: load,
			path: '/moderation/templates',
			session: admin.session
		});
		expect(response.status).toBe(204);
	});
});

describe('load', () => {
	it('splits active and removed templates and counts the memes made from each', async () => {
		const drake = await seed('Drake');
		const doge = await seed('Doge');
		const memeId = await insertMeme(admin.user.id, 'Made from Drake');
		await db.update(media).set({ templateId: drake.id }).where(eq(media.id, memeId));
		expect(await run('remove', admin, { id: String(doge.id) })).toEqual({ ok: true });

		const data = (await load({ locals: { user: admin.user } } as never)) as LoadData;
		expect(data.templates.map((t) => [t.name, t.usageCount])).toEqual([['Drake', 1]]);
		expect(data.removed.map((t) => t.name)).toEqual(['Doge']);
	});

	it('is empty without templates', async () => {
		expect(await load({ locals: { user: admin.user } } as never)).toEqual({
			templates: [],
			removed: []
		});
	});
});

describe('add', () => {
	it('stores the template, audits it and returns ok', async () => {
		const row = await seed('Drake');
		expect(row).toMatchObject({ name: 'Drake', width: 300, height: 200, createdBy: admin.user.id });
		expect(await audits('template_added')).toHaveLength(1);
	});

	it('asks for an image when no file or an empty file is sent', async () => {
		for (const file of [undefined, ''] as const) {
			expect(await add(admin, 'Drake', file)).toEqual({
				status: 400,
				data: { error: 'Pick an image first.' }
			});
		}
		expect(await db.select().from(templates)).toHaveLength(0);
	});

	it('asks for an image when the file field holds plain text', async () => {
		const result = await actions.add({
			request: post(fields({ name: 'Drake', file: 'not a file' })),
			locals: { user: admin.user }
		} as never);
		expect(result).toMatchObject({ status: 400, data: { error: 'Pick an image first.' } });
	});

	it('explains a bad name', async () => {
		for (const name of ['', '   ', 'x'.repeat(61), null]) {
			expect(await add(admin, name, png)).toEqual({
				status: 400,
				data: { error: 'The name must be 1 to 60 characters.' }
			});
		}
		expect(await db.select().from(templates)).toHaveLength(0);
	});

	it('explains an unsupported file type', async () => {
		const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
			.gif()
			.toBuffer();
		expect(await add(admin, 'Drake', gif)).toEqual({
			status: 400,
			data: { error: 'Unsupported file type. Use a JPEG, PNG or WebP image.' }
		});
	});

	it('explains an oversized file', async () => {
		const big = Buffer.alloc(env.AVATAR_MAX_MB * 1024 * 1024 + 1);
		expect(await add(admin, 'Drake', big)).toEqual({
			status: 400,
			data: { error: `Image is too large (max ${env.AVATAR_MAX_MB} MB).` }
		});
	});

	it('explains an image that cannot be processed', async () => {
		// a valid PNG header with the pixel data cut off
		expect(await add(admin, 'Drake', png.subarray(0, 60))).toEqual({
			status: 400,
			data: { error: 'That image could not be processed.' }
		});
		expect(await db.select().from(templates)).toHaveLength(0);
	});
});

describe('rename', () => {
	it('renames, trims and audits', async () => {
		const row = await seed('Drake');
		expect(await run('rename', admin, { id: String(row.id), name: '  Drake 2  ' })).toEqual({
			ok: true
		});
		expect((await rowOf(row.id)).name).toBe('Drake 2');
		expect(await audits('template_renamed')).toHaveLength(1);
	});

	it('explains a bad name and keeps the old one', async () => {
		const row = await seed('Drake');
		expect(await run('rename', admin, { id: String(row.id), name: '   ' })).toEqual({
			status: 400,
			data: { error: 'The name must be 1 to 60 characters.' }
		});
		expect((await rowOf(row.id)).name).toBe('Drake');
	});
});

describe('remove and restore', () => {
	it('removes softly and restores, auditing both', async () => {
		const row = await seed('Drake');
		expect(await run('remove', admin, { id: String(row.id) })).toEqual({ ok: true });
		expect((await rowOf(row.id)).removedAt).not.toBeNull();
		expect(await audits('template_removed')).toHaveLength(1);

		expect(await run('restore', admin, { id: String(row.id) })).toEqual({ ok: true });
		expect((await rowOf(row.id)).removedAt).toBeNull();
		expect(await audits('template_restored')).toHaveLength(1);
	});

	it('says not found for a template that is in the wrong state', async () => {
		const row = await seed('Drake');
		expect(await run('restore', admin, { id: String(row.id) })).toEqual(NOT_FOUND);
		await run('remove', admin, { id: String(row.id) });
		expect(await run('remove', admin, { id: String(row.id) })).toEqual(NOT_FOUND);
	});
});

describe('ids', () => {
	it.each(['rename', 'remove', 'restore'] as const)(
		'%s: a missing, malformed or unknown id is "Template not found." (404)',
		async (name) => {
			for (const id of ['', 'abc', '0', '-3', '1.5', '99999']) {
				expect(await run(name, admin, { id, name: 'Whatever' }), id).toEqual(NOT_FOUND);
			}
			expect(await run(name, admin, { name: 'Whatever' })).toEqual(NOT_FOUND);
		}
	);
});
