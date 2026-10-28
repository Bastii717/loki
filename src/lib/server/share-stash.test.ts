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

	it('carries the optional title and template id through put, peek and take', () => {
		const withMeta = { ...file, title: 'Montag', templateId: 4 };
		putShared(3, withMeta);
		expect(peekShared(3)).toEqual(withMeta);
		expect(takeShared(3)).toEqual(withMeta);
		expect(takeShared(3)).toBeNull();
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

	it('stores a trimmed title (max 120 chars) and a positive integer template id', async () => {
		const png = await sharp({
			create: { width: 2, height: 2, channels: 3, background: '#fff' }
		})
			.png()
			.toBuffer();
		const title = `  ${'x'.repeat(200)}  `;
		expect(await stashSharedFile(10, { name: 'a.png', data: png, title, templateId: 12 })).toBe(
			true
		);
		expect(peekShared(10)).toMatchObject({ title: 'x'.repeat(120), templateId: 12 });
	});

	it('drops an empty title and an invalid template id', async () => {
		const png = await sharp({
			create: { width: 2, height: 2, channels: 3, background: '#fff' }
		})
			.png()
			.toBuffer();
		for (const templateId of [0, -3, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
			const stashed = await stashSharedFile(11, {
				name: 'a.png',
				data: png,
				title: '   ',
				templateId
			});
			expect(stashed).toBe(true);
			const stored = takeShared(11)!;
			expect(stored.title).toBeUndefined();
			expect(stored.templateId).toBeUndefined();
		}
	});

	it('rejects other non-media bytes', async () => {
		expect(await stashSharedFile(9, { name: 'a.pdf', data: Buffer.from('%PDF-1.4\n') })).toBe(
			false
		);
		expect(peekShared(9)).toBeNull();
	});
});

describe('stashSharedFile title truncation', () => {
	it('never leaves a lone surrogate when an emoji straddles the 120 limit', async () => {
		const png = await sharp({
			create: { width: 2, height: 2, channels: 3, background: '#fff' }
		})
			.png()
			.toBuffer();
		const title = `${'a'.repeat(119)}😀tail`;
		expect(await stashSharedFile(11, { name: 'a.png', data: png, title })).toBe(true);
		const stored = peekShared(11)!.title!;
		expect(stored.isWellFormed()).toBe(true);
		expect(stored).toBe(`${'a'.repeat(119)}😀`);
		expect(Array.from(stored)).toHaveLength(120);
	});
});
