import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { env } from './env';
import { s3Client } from './storage';

/**
 * Creates the configured bucket if it does not exist yet (a fresh MinIO in CI has none).
 * Every test file that reaches S3 must call this in its setup instead of relying on another
 * file having created the bucket.
 */
export async function ensureBucket(): Promise<void> {
	try {
		await s3Client().send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
	} catch (e) {
		const name = (e as Error).name;
		if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
	}
}
