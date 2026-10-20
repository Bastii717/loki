import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

const run = promisify(execFile);

export type Kind = 'image' | 'gif' | 'video';

const THUMB_MAX_WIDTH = 640;

const ALLOWED: Record<string, Kind> = {
	'image/jpeg': 'image',
	'image/png': 'image',
	'image/webp': 'image',
	'image/avif': 'image',
	'image/gif': 'gif',
	'video/mp4': 'video',
	'video/webm': 'video'
};

/** Detects the real type from magic bytes; null when not an allowed media type. */
export async function sniffMedia(
	buf: Buffer
): Promise<{ kind: Kind; mime: string; ext: string } | null> {
	const type = await fileTypeFromBuffer(buf);
	const kind = type && ALLOWED[type.mime];
	return type && kind ? { kind, mime: type.mime, ext: type.ext } : null;
}

// Demuxer names ffmpeg must use, so a file cannot be auto-probed as another format (e.g. HLS).
const DEMUXERS: Record<string, string> = {
	'video/mp4': 'mp4',
	'video/webm': 'matroska,webm'
};

async function extractVideoFrame(buf: Buffer): Promise<Buffer> {
	const sniffed = await sniffMedia(buf);
	const demuxer = sniffed?.kind === 'video' ? DEMUXERS[sniffed.mime] : undefined;
	if (!demuxer) throw new Error('not a supported video container');
	if (!ffmpegPath) throw new Error('ffmpeg binary not available for this platform');
	const dir = await mkdtemp(join(tmpdir(), 'loki-media-'));
	try {
		const input = join(dir, 'input');
		const frame = join(dir, 'frame.png');
		await writeFile(input, buf);
		await run(ffmpegPath, [
			'-v',
			'error',
			'-nostdin',
			'-protocol_whitelist',
			'file,pipe',
			'-f',
			demuxer,
			'-i',
			input,
			'-ss',
			'0',
			'-frames:v',
			'1',
			'-y',
			frame
		]);
		return await readFile(frame);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Builds a WebP thumbnail (video: poster at 0s) plus the displayed width/height of the original. */
export async function processMedia(
	buf: Buffer,
	kind: Kind
): Promise<{ thumb: Buffer; width: number; height: number }> {
	const source = kind === 'video' ? await extractVideoFrame(buf) : buf;
	// gifs: sharp reads only the first frame by default
	const { width: w, height: h, orientation } = await sharp(source).metadata();
	if (!w || !h) throw new Error('could not determine media dimensions');
	// EXIF orientations 5-8 swap the axes once rotated upright
	const swap = orientation !== undefined && orientation >= 5;
	const thumb = await sharp(source)
		.rotate()
		.resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
		.webp()
		.toBuffer();
	return { thumb, width: swap ? h : w, height: swap ? w : h };
}
