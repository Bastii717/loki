import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { SHARE_TTL_MS, peekShared, putShared, stashSharedFile, takeShared } from './share-stash';

const file = { name: 'a.png', type: 'image/png', data: Buffer.from('x') };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('share stash', () => {
	it('is keyed per user and consumed by take', () => {
		putShared(1, file);
		expect(peekShared(2)).toBeNull();
		expect(takeShared(1)).toEqual(file);
		expect(takeShared(1)).toBeNull();
	});

	it('expires after the TTL', () => {
		putShared(1, file);
		vi.advanceTimersByTime(SHARE_TTL_MS + 1);
		expect(peekShared(1)).toBeNull();
	});
});

describe('stashSharedFile', () => {
	it('stores real media under the sniffed MIME, ignoring the name', async () => {
		const png = await sharp({
			create: { width: 2, height: 2, channels: 3, background: '#fff' }
		})
			.png()
			.toBuffer();
		expect(await stashSharedFile(7, { name: 'liar.svg', data: png })).toBe(true);
		expect(peekShared(7)).toMatchObject({ name: 'liar.svg', type: 'image/png' });
	});

	it('rejects SVG masquerading as an image', async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
		);
		expect(await stashSharedFile(8, { name: 'x.png', data: svg })).toBe(false);
		expect(peekShared(8)).toBeNull();
	});

	it('rejects other non-media bytes', async () => {
		expect(await stashSharedFile(9, { name: 'a.pdf', data: Buffer.from('%PDF-1.4\n') })).toBe(
			false
		);
		expect(peekShared(9)).toBeNull();
	});
});
