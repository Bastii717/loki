import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { users } from './db/schema';
import { env } from './env';
import { sniffMedia } from './media/process';
import { assertNotTimedOut, audit, AUDIT_ACTIONS } from './moderation';
import { ProfileInputError } from './profile';
import { deleteObjects, putObject } from './storage';

const FULL_SIZE = 256;
const THUMB_SIZE = 64;
const WEBP_QUALITY = 82;
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class AvatarError extends Error {
	constructor(public code: 'type' | 'size' | 'process') {
		super(`avatar rejected: ${code}`);
		this.name = 'AvatarError';
	}
}

/** The user-facing message for a rejected avatar upload. */
export function avatarErrorMessage(e: AvatarError): string {
	switch (e.code) {
		case 'type':
			return 'Unsupported file type. Use a JPEG, PNG or WebP image.';
		case 'size':
			return `Image is too large (max ${env.AVATAR_MAX_MB} MB).`;
		case 'process':
			return 'That image could not be processed.';
	}
}

/** A fresh, unguessable key pair sharing one uuid: avatars/u{id}/{uuid}-256.webp and -64.webp. */
export function avatarKeys(userId: number): { key: string; thumbKey: string } {
	const id = randomUUID();
	return {
		key: `avatars/u${userId}/${id}-${FULL_SIZE}.webp`,
		thumbKey: `avatars/u${userId}/${id}-${THUMB_SIZE}.webp`
	};
}

/** Auto-rotates, cover-crops to a square and re-encodes; sharp drops all metadata by default. */
function square(file: Buffer, size: number): Promise<Buffer> {
	return sharp(file)
		.rotate()
		.resize(size, size, { fit: 'cover' })
		.webp({ quality: WEBP_QUALITY })
		.toBuffer();
}

/** The small copy comes from the already cropped 256 px image: the input is decoded only once. */
function thumbnail(full: Buffer): Promise<Buffer> {
	return sharp(full)
		.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
		.webp({ quality: WEBP_QUALITY })
		.toBuffer();
}

async function deleteQuietly(keys: string[]): Promise<void> {
	if (keys.length === 0) return;
	try {
		await deleteObjects(keys);
	} catch (cleanupError) {
		console.error('avatar cleanup failed', { keys, cleanupError });
	}
}

/**
 * Replaces the actor's own avatar. The size cap is checked before the content is looked at, only
 * JPEG, PNG and WebP are accepted, and the result is two square WebP files. The previous objects
 * are deleted only after the row points at the new ones.
 */
export async function setAvatar(
	actor: SessionUser,
	file: Buffer
): Promise<{ avatarKey: string; avatarThumbKey: string }> {
	await assertNotTimedOut(actor);
	if (file.length > env.AVATAR_MAX_MB * 1024 * 1024) throw new AvatarError('size');
	const sniffed = await sniffMedia(file);
	if (!sniffed || !ACCEPTED_MIME.has(sniffed.mime)) throw new AvatarError('type');

	let full: Buffer;
	let thumb: Buffer;
	try {
		full = await square(file, FULL_SIZE);
		thumb = await thumbnail(full);
	} catch {
		throw new AvatarError('process');
	}

	const { key: avatarKey, thumbKey: avatarThumbKey } = avatarKeys(actor.id);
	const uploaded: string[] = [];
	let previous: string[];
	try {
		// register before awaiting: a PUT that fails midway may still have left the object behind
		uploaded.push(avatarKey);
		await putObject(avatarKey, full, 'image/webp');
		uploaded.push(avatarThumbKey);
		await putObject(avatarThumbKey, thumb, 'image/webp');

		previous = await db.transaction(async (tx) => {
			const [row] = await tx
				.select({ key: users.avatarKey, thumbKey: users.avatarThumbKey })
				.from(users)
				.where(eq(users.id, actor.id))
				.for('update');
			await tx.update(users).set({ avatarKey, avatarThumbKey }).where(eq(users.id, actor.id));
			await audit(actor.id, AUDIT_ACTIONS.avatarChanged, 'user', actor.id, `key=${avatarKey}`, tx);
			return [row?.key, row?.thumbKey].filter((k): k is string => !!k);
		});
	} catch (e) {
		await deleteQuietly(uploaded);
		throw e;
	}

	await deleteQuietly(previous);
	return { avatarKey, avatarThumbKey };
}

/**
 * Removes an avatar: members their own (even while timed out), admins anybody's. Does nothing,
 * and records nothing, when there is no avatar.
 */
export async function removeAvatar(actor: SessionUser, userId: number): Promise<void> {
	const self = actor.id === userId;
	if (!self && actor.role !== 'admin') {
		throw new ProfileInputError('Only admins can remove the avatar of other members.');
	}
	const removed = await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ key: users.avatarKey, thumbKey: users.avatarThumbKey })
			.from(users)
			.where(eq(users.id, userId))
			.for('update');
		if (!row) throw new ProfileInputError('Member not found.');
		const keys = [row.key, row.thumbKey].filter((k): k is string => !!k);
		if (keys.length === 0) return keys;
		await tx
			.update(users)
			.set({ avatarKey: null, avatarThumbKey: null })
			.where(eq(users.id, userId));
		await audit(
			actor.id,
			AUDIT_ACTIONS.avatarRemoved,
			'user',
			userId,
			`by=${self ? 'self' : 'admin'}`,
			tx
		);
		return keys;
	});
	await deleteQuietly(removed);
}
