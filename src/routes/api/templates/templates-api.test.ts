import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import { templates } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { userWithSession } from '../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../lib/server/rate-limit';
import { deleteObjects, getObject } from '../../../lib/server/storage';
import { ensureBucket } from '../../../lib/server/storage-test-utils';
import { callRoute } from '../../../lib/server/test-request';
import { addTemplate, removeTemplate } from '../../../lib/server/templates';
import { GET as getImage } from './[pid]/image/+server';
import { GET as getThumb } from './[pid]/thumb/+server';

const created: string[] = [];
let png: Buffer;

beforeAll(async () => {
	await setupDb();
	await ensureBucket();
	png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#00f' } })
		.png()
		.toBuffer();
});

beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

afterAll(async () => {
	if (created.length) await deleteObjects(created);
});

async function world() {
	const admin = await userWithSession('admin');
	const member = await userWithSession('member');
	const { id: pid } = await addTemplate(admin.user, 'Fine', png);
	const [row] = await db.select().from(templates).where(eq(templates.publicId, pid));
	created.push(row.objectKey, row.thumbKey);
	return { admin, member, row };
}

const endpoints = [
	['image', getImage, 'objectKey', 1600],
	['thumb', getThumb, 'thumbKey', 320]
] as const;

describe.each(endpoints)('GET /api/templates/[pid]/%s', (name, handler, keyField, side) => {
	const path = (pid: string) => `/api/templates/${pid}/${name}`;

	it('streams the stored WebP with the cache headers', async () => {
		const { member, row } = await world();
		const { response } = await callRoute({
			handler,
			path: path(row.publicId),
			params: { pid: row.publicId },
			session: member.session
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/webp');
		expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		const bytes = Buffer.from(await response.arrayBuffer());
		expect(bytes.equals((await getObject(row[keyField])).body)).toBe(true);
		expect((await sharp(bytes).metadata()).width).toBe(side);
	});

	it('answers 404 for an unknown public id', async () => {
		const { member } = await world();
		const { response } = await callRoute({
			handler,
			path: path('AAAAAAAAAAAA'),
			params: { pid: 'AAAAAAAAAAAA' },
			session: member.session
		});
		expect(response.status).toBe(404);
	});

	it.each(['0', '1', '-1', '1.5', 'abc', '99999999999', 'AAAAAAAAAAAAA'])(
		'answers 404 for the id %s',
		async (pid) => {
			const { member } = await world();
			const { response } = await callRoute({
				handler,
				path: path(pid),
				params: { pid },
				session: member.session
			});
			expect(response.status).toBe(404);
		}
	);

	it('answers 404 for the internal numeric id of an existing template', async () => {
		const { member, row } = await world();
		const { response } = await callRoute({
			handler,
			path: path(String(row.id)),
			params: { pid: String(row.id) },
			session: member.session
		});
		expect(response.status).toBe(404);
	});

	it('answers 404 for a removed template', async () => {
		const { admin, member, row } = await world();
		await removeTemplate(admin.user, row.publicId);
		const { response } = await callRoute({
			handler,
			path: path(row.publicId),
			params: { pid: row.publicId },
			session: member.session
		});
		expect(response.status).toBe(404);
	});

	it('serves a removed template to an admin only', async () => {
		const { admin, member, row } = await world();
		await removeTemplate(admin.user, row.publicId);
		const call = (session: string) =>
			callRoute({
				handler,
				path: path(row.publicId),
				params: { pid: row.publicId },
				session
			});
		const asAdmin = (await call(admin.session)).response;
		expect(asAdmin.status).toBe(200);
		expect(asAdmin.headers.get('content-type')).toBe('image/webp');
		expect((await call(member.session)).response.status).toBe(404);
	});

	it('answers 401 JSON for an anonymous request', async () => {
		const { row } = await world();
		const { response } = await callRoute({
			handler,
			path: path(row.publicId),
			params: { pid: row.publicId }
		});
		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toContain('application/json');
	});
});
