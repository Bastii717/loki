import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { peekShared, takeShared } from '../../lib/server/share-stash';
import { GET } from './file/+server';
import { POST } from './+server';

async function share(userId: number, file: File) {
	const body = new FormData();
	body.set('file', file);
	const event = {
		request: new Request('https://loki.test/share', { method: 'POST', body }),
		locals: { user: { id: userId } }
	} as unknown as RequestEvent;
	try {
		await POST(event as never);
	} catch (e) {
		if (isRedirect(e)) return e.location;
		throw e;
	}
	throw new Error('expected a redirect');
}

describe('PWA share target', () => {
	it('rejects an SVG that claims to be an image and never stashes it', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
		const location = await share(101, new File([svg], 'x.svg', { type: 'image/png' }));
		expect(location).toBe('/upload');
		expect(peekShared(101)).toBeNull();
	});

	it('serves a stashed file with the sniffed type and hardening headers', async () => {
		const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } })
			.png()
			.toBuffer();
		// declared type is a lie (svg); the bytes decide
		const location = await share(102, new File([png], 'a.png', { type: 'image/svg+xml' }));
		expect(location).toBe('/upload?shared=1');

		const res = GET({ locals: { user: { id: 102 } } } as never) as Response;
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('content-security-policy')).toBe('sandbox');
		expect(takeShared(102)).toBeNull(); // consumed
	});
});
