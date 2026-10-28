import { randomUUID } from 'node:crypto';
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

let client: S3Client | undefined;

/** Lazily created S3 client (MinIO in dev, R2 or any S3-compatible service in prod). */
export function s3Client(): S3Client {
	client ??= new S3Client({
		endpoint: env.S3_ENDPOINT,
		region: env.S3_REGION,
		forcePathStyle: env.S3_FORCE_PATH_STYLE,
		// Cloudflare R2 rejects the default CRC32 checksums of recent SDK versions
		requestChecksumCalculation: 'WHEN_REQUIRED',
		responseChecksumValidation: 'WHEN_REQUIRED',
		credentials: {
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY
		}
	});
	return client;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
	await s3Client().send(
		new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType })
	);
}

/** S3 accepts at most 1000 keys per DeleteObjects request. */
const DELETE_BATCH = 1000;

export async function deleteObjects(keys: string[]): Promise<void> {
	for (let i = 0; i < keys.length; i += DELETE_BATCH) {
		const result = await s3Client().send(
			new DeleteObjectsCommand({
				Bucket: env.S3_BUCKET,
				Delete: {
					Objects: keys.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })),
					Quiet: true
				}
			})
		);
		if (result.Errors?.length) {
			throw new Error(
				`Failed to delete objects: ${result.Errors.map((e) => `${e.Key} (${e.Code})`).join(', ')}`
			);
		}
	}
}

/** Reads a whole object into memory; throws when the object does not exist. */
export async function getObject(
	key: string
): Promise<{ body: Buffer; contentType: string | null }> {
	const result = await s3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	if (!result.Body) throw new Error(`Object has no body: ${key}`);
	return {
		body: Buffer.from(await result.Body.transformToByteArray()),
		contentType: result.ContentType ?? null
	};
}

export function getPresignedUrl(key: string, ttlSeconds = 60): Promise<string> {
	return getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
		expiresIn: ttlSeconds
	});
}

/** Unguessable object key without any user or sequence number in it: memes/{uuid}.{ext} */
export function mediaKey(ext: string): string {
	return `memes/${randomUUID()}.${ext}`;
}
