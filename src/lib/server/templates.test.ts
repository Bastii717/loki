import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { auditLog, media, templates } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { env } from './env';
import { insertMeme } from './moderation-test-utils';
import * as storage from './storage';
import { ensureBucket } from './storage-test-utils';
import {
	addTemplate,
	getTemplate,
	listTemplates,
	removeTemplate,
	renameTemplate,
	restoreTemplate,
	TEMPLATE_MAX_SIDE,
	TEMPLATE_NAME_MAX,
	TEMPLATE_THUMB_SIDE,
	TemplateError,
	templateErrorMessage
} from './templates';

const ADMIN_ONLY = 'This area is for admins only.';

const exists = (Key: string) =>
	storage
		.s3Client()
		.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }))
		.then(
			() => true,
			() => false
		);

const created: string[] = [];
let jpeg: Buffer;
let png: Buffer;
let webp: Buffer;
let gif: Buffer;
let admin: SessionUser;

const solid = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 3, background: '#0a0' } });

async function makeAdmin(role: SessionUser['role'] = 'admin'): Promise<SessionUser> {
	const u = await testUser({ role });
	return { id: u.id, username: u.username, displayName: null, role };
}

async function add(name: string, file: Buffer, actor = admin) {
	const { id } = await addTemplate(actor, name, file);
	const [row] = await db.select().from(templates).where(eq(templates.id, id));
	created.push(row.objectKey, row.thumbKey);
	return row;
}

async function audits(action: string) {
	return (await db.select().from(auditLog)).filter((a) => a.action === action);
}

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	jpeg = await solid(2400, 1200).jpeg().toBuffer();
	png = await solid(300, 500).png().toBuffer();
	webp = await solid(120, 80).webp().toBuffer();
	gif = await solid(100, 100).gif().toBuffer();
});

beforeEach(async () => {
	await resetDb();
	admin = await makeAdmin();
});

afterEach(() => {
	vi.restoreAllMocks();
});

afterAll(async () => {
	if (created.length) await storage.deleteObjects(created);
});

describe('templateErrorMessage', () => {
	it('returns a message per code', () => {
		expect(templateErrorMessage(new TemplateError('name'))).toBe(
			`The name must be 1 to ${TEMPLATE_NAME_MAX} characters.`
		);
		expect(templateErrorMessage(new TemplateError('type'))).toBe(
			'Unsupported file type. Use a JPEG, PNG or WebP image.'
		);
		expect(templateErrorMessage(new TemplateError('size'))).toBe(
			`Image is too large (max ${env.AVATAR_MAX_MB} MB).`
		);
		expect(templateErrorMessage(new TemplateError('process'))).toBe(
			'That image could not be processed.'
		);
		expect(templateErrorMessage(new TemplateError('notfound'))).toBe('Template not found.');
		expect(templateErrorMessage(new TemplateError('forbidden'))).toBe(ADMIN_ONLY);
	});

	it('exposes the size constants', () => {
		expect([TEMPLATE_NAME_MAX, TEMPLATE_MAX_SIDE, TEMPLATE_THUMB_SIDE]).toEqual([60, 1600, 320]);
	});
});

describe('addTemplate', () => {
	it.each([
		['a JPEG', () => jpeg],
		['a PNG', () => png],
		['a WebP', () => webp]
	])('accepts %s', async (_name, input) => {
		const row = await add('Distracted', input());
		expect(row.name).toBe('Distracted');
		expect(row.createdBy).toBe(admin.id);
		expect(row.removedAt).toBeNull();
		expect(row.objectKey).toMatch(/^templates\/[0-9a-f-]{36}\.webp$/);
		expect(row.thumbKey).toBe(row.objectKey.replace(/\.webp$/, '-320.webp'));
	});

	it('stores a 1600-bounded WebP and a 320 thumbnail that keep the aspect ratio', async () => {
		const row = await add('Wide', jpeg);
		const full = await storage.getObject(row.objectKey);
		const thumb = await storage.getObject(row.thumbKey);
		expect(full.contentType).toBe('image/webp');
		const fullMeta = await sharp(full.body).metadata();
		const thumbMeta = await sharp(thumb.body).metadata();
		expect(fullMeta.format).toBe('webp');
		expect([fullMeta.width, fullMeta.height]).toEqual([1600, 800]);
		expect([thumbMeta.width, thumbMeta.height]).toEqual([320, 160]);
		expect([row.width, row.height]).toEqual([1600, 800]);
	});

	it('does not enlarge small images', async () => {
		const row = await add('Small', webp);
		const thumb = await sharp((await storage.getObject(row.thumbKey)).body).metadata();
		expect([row.width, row.height]).toEqual([120, 80]);
		expect([thumb.width, thumb.height]).toEqual([120, 80]);
	});

	it('bounds the longest side of a portrait image', async () => {
		const tall = await solid(900, 3000).png().toBuffer();
		const row = await add('Tall', tall);
		expect([row.width, row.height]).toEqual([480, 1600]);
		const thumb = await sharp((await storage.getObject(row.thumbKey)).body).metadata();
		expect([thumb.width, thumb.height]).toEqual([96, 320]);
	});

	it('trims the name and records template_added with name and key', async () => {
		const row = await add('  Two buttons  ', png);
		expect(row.name).toBe('Two buttons');
		const [entry] = await audits('template_added');
		expect(entry).toMatchObject({
			actorId: admin.id,
			targetType: 'template',
			targetId: row.id,
			detail: `name="Two buttons" key=${row.objectKey}`
		});
	});

	it.each([
		['a GIF', () => gif, 'type'],
		['an SVG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'type'],
		['text', () => Buffer.from('hello'), 'type']
	])('rejects %s', async (_name, input, code) => {
		await expect(addTemplate(admin, 'X', input())).rejects.toMatchObject({ code });
		expect(await db.select().from(templates)).toEqual([]);
	});

	it('rejects a file over the size cap before looking at it', async () => {
		const big = Buffer.alloc(env.AVATAR_MAX_MB * 1024 * 1024 + 1);
		const err = await addTemplate(admin, 'Big', big).catch((e) => e);
		expect(err).toBeInstanceOf(TemplateError);
		expect(err.code).toBe('size');
		expect(templateErrorMessage(err)).toBe(`Image is too large (max ${env.AVATAR_MAX_MB} MB).`);
	});

	it('rejects an image that decodes to nothing as process error', async () => {
		const truncated = png.subarray(0, 60);
		await expect(addTemplate(admin, 'Broken', truncated)).rejects.toMatchObject({
			code: 'process'
		});
	});

	it.each([
		['empty', ''],
		['blank', '   '],
		['61 characters', 'x'.repeat(61)]
	])('rejects a name that is %s', async (_label, name) => {
		await expect(addTemplate(admin, name, png)).rejects.toMatchObject({ code: 'name' });
		expect(await db.select().from(templates)).toEqual([]);
	});

	it('accepts a name of exactly 60 characters', async () => {
		const row = await add('x'.repeat(60), png);
		expect(row.name).toHaveLength(60);
	});

	it('rejects moderators and members with the admin message', async () => {
		for (const role of ['moderator', 'member'] as const) {
			const actor = await makeAdmin(role);
			const err = await addTemplate(actor, 'Nope', png).catch((e) => e);
			expect(err).toBeInstanceOf(TemplateError);
			expect(err.code).toBe('forbidden');
			expect(templateErrorMessage(err)).toBe(ADMIN_ONLY);
		}
		expect(await db.select().from(templates)).toEqual([]);
	});

	it('deletes the uploaded objects and writes no audit row when the database write fails', async () => {
		const put = vi.spyOn(storage, 'putObject');
		// an actor id that does not exist makes the insert (created_by foreign key) fail
		const ghost = { ...admin, id: admin.id + 1000 };
		await expect(addTemplate(ghost, 'Ghost', png)).rejects.toThrow();
		expect(put).toHaveBeenCalledTimes(2);
		for (const call of put.mock.calls) expect(await exists(call[0])).toBe(false);
		expect(await db.select().from(templates)).toEqual([]);
		expect(await audits('template_added')).toEqual([]);
	});
});

describe('renameTemplate', () => {
	it('renames, trims and audits from and to', async () => {
		const row = await add('Old', png);
		await renameTemplate(admin, row.id, '  New name ');
		expect((await getTemplate(row.id))?.name).toBe('New name');
		const [entry] = await audits('template_renamed');
		expect(entry).toMatchObject({
			actorId: admin.id,
			targetType: 'template',
			targetId: row.id,
			detail: 'from="Old" to="New name"'
		});
	});

	it('validates the name', async () => {
		const row = await add('Old', png);
		await expect(renameTemplate(admin, row.id, ' ')).rejects.toMatchObject({ code: 'name' });
		await expect(renameTemplate(admin, row.id, 'x'.repeat(61))).rejects.toMatchObject({
			code: 'name'
		});
		expect((await getTemplate(row.id))?.name).toBe('Old');
		expect(await audits('template_renamed')).toEqual([]);
	});

	it('fails for an unknown template', async () => {
		await expect(renameTemplate(admin, 999, 'X')).rejects.toMatchObject({ code: 'notfound' });
	});

	it('also renames a removed template', async () => {
		const row = await add('Old', png);
		await removeTemplate(admin, row.id);
		await renameTemplate(admin, row.id, 'Renamed');
		const [all] = (await listTemplates({ includeRemoved: true })).filter((t) => t.id === row.id);
		expect(all.name).toBe('Renamed');
	});

	it('rejects non-admins', async () => {
		const row = await add('Old', png);
		await expect(renameTemplate(await makeAdmin('moderator'), row.id, 'X')).rejects.toMatchObject({
			code: 'forbidden'
		});
	});
});

describe('removeTemplate and restoreTemplate', () => {
	it('soft-deletes: row and files stay, listings and lookups drop it', async () => {
		const row = await add('Gone', png);
		await removeTemplate(admin, row.id);

		const [stored] = await db.select().from(templates).where(eq(templates.id, row.id));
		expect(stored.removedAt).toBeInstanceOf(Date);
		expect(await exists(row.objectKey)).toBe(true);
		expect(await exists(row.thumbKey)).toBe(true);
		expect(await getTemplate(row.id)).toBeNull();
		expect(await getTemplate(row.id, { includeRemoved: false })).toBeNull();
		expect((await getTemplate(row.id, { includeRemoved: true }))?.removedAt).toBe(
			stored.removedAt!.toISOString()
		);
		expect(await listTemplates()).toEqual([]);
		const withRemoved = await listTemplates({ includeRemoved: true });
		expect(withRemoved).toHaveLength(1);
		expect(withRemoved[0].removedAt).toBe(stored.removedAt!.toISOString());

		const [entry] = await audits('template_removed');
		expect(entry).toMatchObject({
			actorId: admin.id,
			targetType: 'template',
			targetId: row.id,
			detail: 'name="Gone"'
		});
	});

	it('restores a removed template and audits it', async () => {
		const row = await add('Back', png);
		await removeTemplate(admin, row.id);
		await restoreTemplate(admin, row.id);
		expect((await getTemplate(row.id))?.removedAt).toBeNull();
		expect(await listTemplates()).toHaveLength(1);
		const [entry] = await audits('template_restored');
		expect(entry).toMatchObject({ targetId: row.id, detail: 'name="Back"' });
	});

	it('fails for unknown ids, a template already removed and one not removed', async () => {
		const row = await add('Once', png);
		await expect(removeTemplate(admin, 999)).rejects.toMatchObject({ code: 'notfound' });
		await expect(restoreTemplate(admin, row.id)).rejects.toMatchObject({ code: 'notfound' });
		await removeTemplate(admin, row.id);
		await expect(removeTemplate(admin, row.id)).rejects.toMatchObject({ code: 'notfound' });
		expect(await audits('template_removed')).toHaveLength(1);
		expect(await audits('template_restored')).toEqual([]);
	});

	it('rejects non-admins', async () => {
		const row = await add('Safe', png);
		const mod = await makeAdmin('moderator');
		await expect(removeTemplate(mod, row.id)).rejects.toMatchObject({ code: 'forbidden' });
		await expect(restoreTemplate(mod, row.id)).rejects.toMatchObject({ code: 'forbidden' });
		expect(await getTemplate(row.id)).not.toBeNull();
	});
});

describe('listTemplates and getTemplate', () => {
	it('counts memes made from a template', async () => {
		const row = await add('Counted', png);
		const other = await add('Unused', png);
		const author = await testUser();
		const a = await insertMeme(author.id);
		const b = await insertMeme(author.id);
		await insertMeme(author.id);
		await db.update(media).set({ templateId: row.id }).where(eq(media.id, a));
		await db.update(media).set({ templateId: row.id }).where(eq(media.id, b));

		const list = await listTemplates();
		expect(list.find((t) => t.id === row.id)?.usageCount).toBe(2);
		expect(list.find((t) => t.id === other.id)?.usageCount).toBe(0);
		expect((await getTemplate(row.id))?.usageCount).toBe(2);
	});

	it('orders active by usage desc then name asc, removed ones last', async () => {
		const zed = await add('Zed', png);
		const alpha = await add('Alpha', png);
		const beta = await add('Beta', png);
		const gone = await add('Gone', png);
		const author = await testUser();
		const m1 = await insertMeme(author.id);
		const m2 = await insertMeme(author.id);
		const m3 = await insertMeme(author.id);
		await db.update(media).set({ templateId: zed.id }).where(eq(media.id, m1));
		await db.update(media).set({ templateId: gone.id }).where(eq(media.id, m2));
		await db.update(media).set({ templateId: gone.id }).where(eq(media.id, m3));
		await removeTemplate(admin, gone.id);

		expect((await listTemplates()).map((t) => t.name)).toEqual(['Zed', 'Alpha', 'Beta']);
		expect((await listTemplates({ includeRemoved: true })).map((t) => t.name)).toEqual([
			'Zed',
			'Alpha',
			'Beta',
			'Gone'
		]);
		expect(alpha.id).toBeLessThan(beta.id);
	});

	it('returns the full row shape', async () => {
		const row = await add('Shape', webp);
		expect(await getTemplate(row.id)).toEqual({
			id: row.id,
			name: 'Shape',
			objectKey: row.objectKey,
			thumbKey: row.thumbKey,
			width: 120,
			height: 80,
			usageCount: 0,
			removedAt: null
		});
	});

	it('returns null for an unknown id', async () => {
		expect(await getTemplate(12345)).toBeNull();
		expect(await getTemplate(12345, { includeRemoved: true })).toBeNull();
	});

	it('keeps the template when its creator is deleted', async () => {
		const creator = await makeAdmin();
		const row = await add('Orphan', png, creator);
		await db.delete(auditLog);
		await db.execute(sql`DELETE FROM users WHERE id = ${creator.id}`);
		const [stored] = await db.select().from(templates).where(eq(templates.id, row.id));
		expect(stored.createdBy).toBeNull();
	});
});
