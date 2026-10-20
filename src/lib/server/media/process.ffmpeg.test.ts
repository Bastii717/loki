import { beforeEach, describe, expect, it, vi } from 'vitest';

// processMedia promisifies execFile, so the mock exposes the promisified form directly
const execFileAsync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
	const { promisify } = await import('node:util');
	const execFile = Object.assign(vi.fn(), { [promisify.custom]: execFileAsync });
	return { execFile };
});

import { processMedia } from './process';

// minimal ftyp box: sniffs as mp4, never actually decoded because ffmpeg is mocked
const mp4Header = Buffer.concat([
	Buffer.from([0, 0, 0, 0x18]),
	Buffer.from('ftypmp42\0\0\0\0mp42isom')
]);

describe('processMedia ffmpeg failure handling', () => {
	beforeEach(() => {
		execFileAsync.mockReset();
	});

	it('passes a timeout to ffmpeg and reports a kill as a timeout', async () => {
		execFileAsync.mockImplementation(() =>
			Promise.reject(Object.assign(new Error('Command failed'), { killed: true }))
		);
		const err = await processMedia(mp4Header, 'video').then(
			() => null,
			(e: Error) => e
		);
		expect(err?.message).toMatch(/timed out/);
		expect(execFileAsync.mock.calls[0][2]).toMatchObject({ timeout: 15_000 });
	});

	it('includes ffmpeg stderr in the error', async () => {
		execFileAsync.mockImplementation(() =>
			Promise.reject(
				Object.assign(new Error('Command failed'), { stderr: 'moov atom not found\n' })
			)
		);
		const err = await processMedia(mp4Header, 'video').then(
			() => null,
			(e: Error) => e
		);
		expect(err?.message).toMatch(/moov atom not found/);
	});

	it('reports a clear error when ffmpeg exits 0 without writing a frame', async () => {
		execFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
		await expect(processMedia(mp4Header, 'video')).rejects.toThrow('no video frame extracted');
	});
});
