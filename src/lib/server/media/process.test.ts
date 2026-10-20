import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processMedia, sniffMedia } from './process';

const run = promisify(execFile);

// Fixtures are generated at test time (real sharp / ffmpeg output) so no binaries are committed.
let dir: string;
let jpg: Buffer;
let smallJpg: Buffer;
let rotatedJpg: Buffer;
let png: Buffer;
let gif: Buffer;
let mp4: Buffer;
let webm: Buffer;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'loki-fixtures-'));
	const base = (w: number, h: number) =>
		sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } });
	jpg = await base(1200, 600).jpeg().toBuffer();
	smallJpg = await base(100, 50).jpeg().toBuffer();
	// stored 200x100 with EXIF orientation 6 => displayed as 100x200
	rotatedJpg = await base(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
	png = await base(50, 50).png().toBuffer();
	gif = await base(800, 400).gif().toBuffer();
	const out = join(dir, 'v.mp4');
	await run(ffmpegPath!, [
		'-v',
		'error',
		'-f',
		'lavfi',
		'-i',
		'color=c=black:s=320x180:d=0.2:r=10',
		'-pix_fmt',
		'yuv420p',
		'-c:v',
		'libx264',
		'-y',
		out
	]);
	mp4 = await readFile(out);
	const outWebm = join(dir, 'v.webm');
	await run(ffmpegPath!, [
		'-v',
		'error',
		'-f',
		'lavfi',
		'-i',
		'color=c=black:s=160x90:d=0.2:r=10',
		'-c:v',
		'libvpx',
		'-y',
		outWebm
	]);
	webm = await readFile(outWebm);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('sniffMedia', () => {
	it('detects jpeg, png, gif and mp4 by magic bytes', async () => {
		expect(await sniffMedia(jpg)).toEqual({ kind: 'image', mime: 'image/jpeg', ext: 'jpg' });
		expect(await sniffMedia(png)).toMatchObject({ kind: 'image', mime: 'image/png' });
		expect(await sniffMedia(gif)).toEqual({ kind: 'gif', mime: 'image/gif', ext: 'gif' });
		expect(await sniffMedia(mp4)).toMatchObject({ kind: 'video', mime: 'video/mp4' });
	});

	it('returns null for disallowed or unknown content', async () => {
		expect(await sniffMedia(Buffer.from('%PDF-1.4\n1 0 obj\n'))).toBeNull();
		expect(await sniffMedia(Buffer.from('hello world'))).toBeNull();
		expect(await sniffMedia(Buffer.alloc(0))).toBeNull();
	});
});

describe('processMedia', () => {
	it('makes a WebP thumbnail capped at 640px wide, keeping aspect', async () => {
		const r = await processMedia(jpg, 'image');
		expect((await fileTypeFromBuffer(r.thumb))?.mime).toBe('image/webp');
		const meta = await sharp(r.thumb).metadata();
		expect([meta.width, meta.height]).toEqual([640, 320]);
		expect({ width: r.width, height: r.height }).toEqual({ width: 1200, height: 600 });
	});

	it('never upscales small images', async () => {
		const r = await processMedia(smallJpg, 'image');
		expect((await sharp(r.thumb).metadata()).width).toBe(100);
		expect(r).toMatchObject({ width: 100, height: 50 });
	});

	it('reports display dimensions for EXIF-rotated images', async () => {
		const r = await processMedia(rotatedJpg, 'image');
		expect(r).toMatchObject({ width: 100, height: 200 });
		const meta = await sharp(r.thumb).metadata();
		expect([meta.width, meta.height]).toEqual([100, 200]);
	});

	it('thumbnails the first frame of a gif as WebP', async () => {
		const r = await processMedia(gif, 'gif');
		expect((await fileTypeFromBuffer(r.thumb))?.mime).toBe('image/webp');
		expect((await sharp(r.thumb).metadata()).width).toBe(640);
		expect(r).toMatchObject({ width: 800, height: 400 });
	});

	it('extracts a WebP poster from a video', async () => {
		const r = await processMedia(mp4, 'video');
		expect((await fileTypeFromBuffer(r.thumb))?.mime).toBe('image/webp');
		expect(r).toMatchObject({ width: 320, height: 180 });
	});

	it('extracts a WebP poster from a webm video', async () => {
		const r = await processMedia(webm, 'video');
		expect((await fileTypeFromBuffer(r.thumb))?.mime).toBe('image/webp');
		expect(r).toMatchObject({ width: 160, height: 90 });
	});

	it('rejects a buffer that sniffs as mp4 but is not decodable', async () => {
		const fake = Buffer.concat([
			Buffer.from([0, 0, 0, 0x18]),
			Buffer.from('ftypmp42\0\0\0\0mp42isom'),
			Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n')
		]);
		expect(await sniffMedia(fake)).toMatchObject({ kind: 'video' });
		await expect(processMedia(fake, 'video')).rejects.toThrow();
	});

	it('rejects video kind for non-video bytes', async () => {
		await expect(processMedia(jpg, 'video')).rejects.toThrow();
	});
});
