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

export type SharedFile = { name: string; type: string; data: Buffer };

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
	return entry ? { name: entry.name, type: entry.type, data: entry.data } : null;
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
	file: { name: string; data: Buffer }
): Promise<boolean> {
	const sniffed = await sniffMedia(file.data);
	if (!sniffed) return false;
	putShared(userId, { name: file.name, type: sniffed.mime, data: file.data });
	return true;
}
