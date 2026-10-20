import { inArray } from 'drizzle-orm';
import type { SessionUser } from '../auth/session';
import { db } from '../db';
import { media, mediaTags, tags } from '../db/schema';
import { env } from '../env';
import { deleteObjects, mediaKey, putObject } from '../storage';
import { processMedia, sniffMedia } from './process';

export class UploadError extends Error {
	constructor(readonly code: 'type' | 'size') {
		super(`upload rejected: ${code}`);
		this.name = 'UploadError';
	}
}

const TAG_PATTERN = /^[a-z0-9äöüß-]{2,30}$/;
const MAX_TAGS = 10;

/** Lowercases, trims and strips one leading `#`; null when the result is not a valid tag. */
export function normalizeTag(raw: string): string | null {
	const tag = raw.trim().toLowerCase().replace(/^#/, '');
	return TAG_PATTERN.test(tag) ? tag : null;
}

export type CreateMediaOptions = {
	uploader: SessionUser;
	file: Buffer;
	title: string;
	tagNames: string[];
	nsfw: boolean;
	spoiler: boolean;
};

/**
 * Validates, processes and stores an upload. Objects are uploaded before the DB insert;
 * if anything fails afterwards the uploaded objects are removed again.
 */
export async function createMedia(opts: CreateMediaOptions): Promise<{ id: number }> {
	const { uploader, file } = opts;
	const sniffed = await sniffMedia(file);
	if (!sniffed) throw new UploadError('type');
	if (file.length > env.MAX_UPLOAD_MB * 1024 * 1024) throw new UploadError('size');

	const { thumb, width, height } = await processMedia(file, sniffed.kind);
	const tagNames = [
		...new Set(opts.tagNames.map(normalizeTag).filter((t): t is string => t !== null))
	].slice(0, MAX_TAGS);

	const objectKey = mediaKey(uploader.id, sniffed.ext);
	const thumbKey = mediaKey(uploader.id, 'webp');
	const uploaded: string[] = [];
	try {
		// register before awaiting: a PUT that fails midway may still have left the object behind
		uploaded.push(objectKey);
		await putObject(objectKey, file, sniffed.mime);
		uploaded.push(thumbKey);
		await putObject(thumbKey, thumb, 'image/webp');

		return await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(media)
				.values({
					uploaderId: uploader.id,
					title: opts.title,
					kind: sniffed.kind,
					objectKey,
					thumbKey,
					width,
					height,
					nsfw: opts.nsfw,
					spoiler: opts.spoiler
				})
				.returning({ id: media.id });
			if (tagNames.length > 0) {
				await tx
					.insert(tags)
					.values(tagNames.map((name) => ({ name })))
					.onConflictDoNothing();
				const tagRows = await tx
					.select({ id: tags.id })
					.from(tags)
					.where(inArray(tags.name, tagNames));
				await tx.insert(mediaTags).values(tagRows.map((t) => ({ mediaId: row.id, tagId: t.id })));
			}
			return { id: row.id };
		});
	} catch (e) {
		try {
			await deleteObjects(uploaded);
		} catch (cleanupError) {
			console.error('upload cleanup failed', { keys: uploaded, cleanupError });
		}
		throw e;
	}
}
