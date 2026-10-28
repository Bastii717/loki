import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../../lib/server/env';
import { UploadError } from '../../lib/server/media/create';
import { render } from 'svelte/server';
import { actions } from './+page.server';
import Page from './+page.svelte';

// A plain function instead of vi.fn(): vitest's result tracking would flag the deliberate rejections.
const stub = vi.hoisted(() => ({ createMedia: async (): Promise<void> => {} }));
vi.mock('../../lib/server/media/create', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../lib/server/media/create')>()),
	createMedia: () => stub.createMedia()
}));

const rejectWith = (error: Error) => {
	stub.createMedia = async () => {
		throw error;
	};
};

async function submit(file?: File) {
	const body = new FormData();
	if (file) body.set('file', file);
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

	it('carries the hand-over template id in a hidden input (empty by default)', () => {
		expect(body()).toMatch(/<input\b(?=[^>]*type="hidden")(?=[^>]*name="templateId")[^>]*>/);
	});
});
