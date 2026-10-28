import type { RequestEvent } from '@sveltejs/kit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/server/db';
import { templates } from '../../lib/server/db/schema';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { env } from '../../lib/server/env';
import { UploadError } from '../../lib/server/media/create';
import { render } from 'svelte/server';
import { actions } from './+page.server';
import Page from './+page.svelte';

// A plain function instead of vi.fn(): vitest's result tracking would flag the deliberate rejections.
const stub = vi.hoisted(() => ({
	calls: [] as Record<string, unknown>[],
	createMedia: async (): Promise<void> => {}
}));
vi.mock('../../lib/server/media/create', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../lib/server/media/create')>()),
	createMedia: (opts: Record<string, unknown>) => {
		stub.calls.push(opts);
		return stub.createMedia();
	}
}));

const rejectWith = (error: Error) => {
	stub.createMedia = async () => {
		throw error;
	};
};

async function submit(file?: File, fields: Record<string, string> = {}) {
	const body = new FormData();
	if (file) body.set('file', file);
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	const event = {
		request: new Request('https://loki.test/upload', { method: 'POST', body }),
		locals: { user: { id: 1 } }
	} as unknown as RequestEvent;
	return (await actions.default(event as never)) as { status: number; data: { message: string } };
}

describe('upload action messages', () => {
	it('asks for a file when none was picked', async () => {
		const res = await submit();
		expect(res.status).toBe(400);
		expect(res.data.message).toBe('Pick a file first');
	});

	it('rejects an unsupported file type', async () => {
		rejectWith(new UploadError('type'));
		const res = await submit(new File(['x'], 'x.pdf'));
		expect(res.status).toBe(415);
		expect(res.data.message).toBe('Unsupported file type');
	});

	it('rejects an oversized file with the configured limit', async () => {
		rejectWith(new UploadError('size'));
		const res = await submit(new File(['x'], 'x.png'));
		expect(res.status).toBe(413);
		expect(res.data.message).toBe(`File is too large (max ${env.MAX_UPLOAD_MB} MB)`);
	});

	it('hides internal error text behind a generic failure', async () => {
		rejectWith(new Error('ffmpeg exploded at /tmp/secret'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await submit(new File(['x'], 'x.png'));
		expect(res.status).toBe(500);
		expect(res.data.message).toBe('Upload failed');
	});
});

describe('upload action template provenance', () => {
	beforeAll(setupDb);
	beforeEach(async () => {
		await resetDb();
		stub.calls.length = 0;
		stub.createMedia = async () => {};
	});

	const insertTemplate = async (removedAt: Date | null = null) => {
		const [row] = await db
			.insert(templates)
			.values({
				name: 'T',
				objectKey: 'templates/x.webp',
				thumbKey: 'templates/x-320.webp',
				width: 10,
				height: 10,
				removedAt
			})
			.returning({ id: templates.id, publicId: templates.publicId });
		return row;
	};

	const posted = async (templateId?: string) => {
		const fields: Record<string, string> = templateId === undefined ? {} : { templateId };
		await expect(submit(new File(['x'], 'x.png'), fields)).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
		expect(stub.calls).toHaveLength(1);
		return stub.calls[0].templateId;
	};

	it('passes the id of an existing template to createMedia', async () => {
		const { id, publicId } = await insertTemplate();
		expect(await posted(publicId)).toBe(id);
	});

	it('ignores a removed, unknown, numeric or malformed template id', async () => {
		const removed = await insertTemplate(new Date());
		const live = await insertTemplate();
		for (const raw of [
			removed.publicId,
			// the internal id is no reference any more
			String(live.id),
			'AAAAAAAAAAAA',
			'abc',
			'-1',
			'0',
			'1e3',
			''
		]) {
			stub.calls.length = 0;
			expect(await posted(raw), raw).toBeNull();
		}
	});

	it('passes null when no template id was sent', async () => {
		expect(await posted()).toBeNull();
	});
});

describe('upload page entry points', () => {
	const body = () =>
		render(Page, { props: { form: null, data: { hasShared: false } as never } }).body;

	it('links to the template generator above the file field', () => {
		const html = body();
		const link = html.match(/<a\b[^>]*href="\/create"[^>]*>[\s\S]*?<\/a>/);
		expect(link, 'generator link rendered').not.toBeNull();
		expect(link![0]).toContain('Make a meme from a template');
		expect(link![0]).toContain('<span aria-hidden="true">→</span>');
		expect(html.indexOf('href="/create"')).toBeLessThan(html.indexOf('name="file"'));
	});

	it('renders NSFW and Spoiler unchecked until a hand-over arrives', () => {
		for (const name of ['nsfw', 'spoiler']) {
			const input = body().match(
				new RegExp(`<input\\b(?=[^>]*type="checkbox")(?=[^>]*name="${name}")[^>]*>`)
			);
			expect(input, name).not.toBeNull();
			expect(input![0], name).not.toMatch(/\bchecked\b/);
		}
	});

	it('carries the hand-over template id in a hidden input (empty by default)', () => {
		const input = body().match(/<input\b(?=[^>]*type="hidden")(?=[^>]*name="templateId")[^>]*>/);
		expect(input).not.toBeNull();
		expect(input![0]).toMatch(/\bvalue=""/);
	});
});
