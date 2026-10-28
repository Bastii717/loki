/**
 * Short-lived, per-user stash for files received through the PWA share target.
 *
 * The OS posts the shared file to /share; the upload page cannot receive it from that
 * request, so it is parked here (in memory, one entry per user, 2-minute TTL) and fetched
 * by the upload page right after the redirect. Single-container limitation applies, like
 * the rate limiter.
 */
import { sniffMedia } from './media/process';

export const SHARE_TTL_MS = 2 * 60 * 1000;

export const MAX_SHARED_TITLE = 120;

/** `title` and `templateId` ride along from the meme generator's hand-over to the upload form. */
export type SharedFile = {
	name: string;
	type: string;
	data: Buffer;
	title?: string;
	templateId?: number;
};

const stash = new Map<number, SharedFile & { expires: number }>();

function sweep(now: number): void {
	for (const [userId, entry] of stash) if (entry.expires <= now) stash.delete(userId);
}

/** Stores the file for the user, replacing any earlier one. */
export function putShared(userId: number, file: SharedFile): void {
	const now = Date.now();
	sweep(now);
	stash.set(userId, { ...file, expires: now + SHARE_TTL_MS });
}

/** Returns the user's stashed file without consuming it, or null if none/expired. */
export function peekShared(userId: number): SharedFile | null {
	sweep(Date.now());
	const entry = stash.get(userId);
	if (!entry) return null;
	const file: SharedFile = { name: entry.name, type: entry.type, data: entry.data };
	if (entry.title !== undefined) file.title = entry.title;
	if (entry.templateId !== undefined) file.templateId = entry.templateId;
	return file;
}

/** Returns and removes the user's stashed file. */
export function takeShared(userId: number): SharedFile | null {
	const file = peekShared(userId);
	stash.delete(userId);
	return file;
}

/**
 * Validates a shared file by its bytes (never by the client-declared type, which could claim
 * `image/svg+xml`) and stashes it under the sniffed MIME. Returns false when the content is
 * not an allowed image/video.
 */
export async function stashSharedFile(
	userId: number,
	file: { name: string; data: Buffer; title?: string; templateId?: number }
): Promise<boolean> {
	const sniffed = await sniffMedia(file.data);
	if (!sniffed) return false;
	const shared: SharedFile = { name: file.name, type: sniffed.mime, data: file.data };
	// cut by code point: a UTF-16 slice could leave a lone surrogate from an emoji at the boundary
	const title = file.title
		? Array.from(file.title.trim()).slice(0, MAX_SHARED_TITLE).join('').trim()
		: '';
	if (title) shared.title = title;
	if (
		file.templateId !== undefined &&
		Number.isSafeInteger(file.templateId) &&
		file.templateId > 0
	) {
		shared.templateId = file.templateId;
	}
	putShared(userId, shared);
	return true;
}
