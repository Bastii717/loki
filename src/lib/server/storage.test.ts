import { beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { deleteObjects, getPresignedUrl, mediaKey, putObject, s3Client } from './storage';
import { env } from './env';

describe('storage', () => {
	beforeAll(async () => {
		try {
			await s3Client().send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
		} catch (e) {
			if ((e as Error).name !== 'BucketAlreadyOwnedByYou') throw e;
		}
	});

	it('mediaKey is namespaced per user and unguessable', () => {
		const a = mediaKey(7, 'png');
		expect(a).toMatch(/^memes\/u7\/[0-9a-f-]{36}\.png$/);
		expect(mediaKey(7, 'png')).not.toBe(a);
	});

	it('put -> presign -> fetch returns bytes and content type', async () => {
		const key = mediaKey(1, 'txt');
		const body = Buffer.from('hello loki');
		await putObject(key, body, 'text/plain');
		const res = await fetch(await getPresignedUrl(key));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/plain');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(body);
		await deleteObjects([key]);
	});

	it('rejects a tampered signature', async () => {
		const key = mediaKey(1, 'txt');
		await putObject(key, Buffer.from('x'), 'text/plain');
		const url = new URL(await getPresignedUrl(key));
		const sig = url.searchParams.get('X-Amz-Signature')!;
		url.searchParams.set('X-Amz-Signature', sig.replace(/.$/, sig.endsWith('0') ? '1' : '0'));
		const res = await fetch(url);
		expect(res.status).not.toBe(200);
		await deleteObjects([key]);
	});

	it('deleteObjects removes objects', async () => {
		const keys = [mediaKey(1, 'txt'), mediaKey(1, 'txt')];
		for (const k of keys) await putObject(k, Buffer.from('x'), 'text/plain');
		const urls = await Promise.all(keys.map((k) => getPresignedUrl(k)));
		await deleteObjects(keys);
		for (const u of urls) expect((await fetch(u)).status).toBe(404);
	});

	it('deleteObjects with no keys is a no-op', async () => {
		await expect(deleteObjects([])).resolves.toBeUndefined();
	});
});
