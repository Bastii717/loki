import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { media, templates } from './db/schema';
import { env } from './env';
import { resolveTemplateId } from './public-ids';
import { sniffMedia } from './media/process';
import { audit, AUDIT_ACTIONS } from './moderation';
import { deleteObjects, putObject } from './storage';

export const TEMPLATE_NAME_MAX = 60;
export const TEMPLATE_MAX_SIDE = 1600;
export const TEMPLATE_THUMB_SIDE = 320;
const FULL_QUALITY = 90;
const THUMB_QUALITY = 82;
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 'forbidden' is the module's second line of defence: the callers gate on admin first. */
export class TemplateError extends Error {
	constructor(readonly code: 'name' | 'type' | 'size' | 'process' | 'notfound' | 'forbidden') {
		super(`template rejected: ${code}`);
		this.name = 'TemplateError';
	}
}

/** The user-facing message for a rejected template action. */
export function templateErrorMessage(e: TemplateError): string {
	switch (e.code) {
		case 'name':
			return `The name must be 1 to ${TEMPLATE_NAME_MAX} characters.`;
		case 'type':
			return 'Unsupported file type. Use a JPEG, PNG or WebP image.';
		case 'size':
			return `Image is too large (max ${env.AVATAR_MAX_MB} MB).`;
		case 'process':
			return 'That image could not be processed.';
		case 'notfound':
			return 'Template not found.';
		case 'forbidden':
			return 'This area is for admins only.';
	}
}

export interface TemplateRow {
	/** The public id; the internal serial never leaves the server. */
	id: string;
	name: string;
	objectKey: string;
	thumbKey: string;
	width: number;
	height: number;
	usageCount: number;
	removedAt: string | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertAdmin(actor: SessionUser): void {
	if (actor.role !== 'admin') throw new TemplateError('forbidden');
}

function cleanName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length < 1 || trimmed.length > TEMPLATE_NAME_MAX) throw new TemplateError('name');
	return trimmed;
}

/** A fresh, unguessable key pair sharing one uuid: templates/{uuid}.webp and -320.webp. */
function templateKeys(): { key: string; thumbKey: string } {
	const id = randomUUID();
	return {
		key: `templates/${id}.webp`,
		thumbKey: `templates/${id}-${TEMPLATE_THUMB_SIDE}.webp`
	};
}

/** Keeps the aspect ratio: the longest side is at most `side`, small images are not enlarged. */
const inside = (side: number) => ({
	width: side,
	height: side,
	fit: 'inside' as const,
	withoutEnlargement: true
});

async function deleteQuietly(keys: string[]): Promise<void> {
	if (keys.length === 0) return;
	try {
		await deleteObjects(keys);
	} catch (cleanupError) {
		console.error('template cleanup failed', { keys, cleanupError });
	}
}

/**
 * Adds a library template (admins only). The size cap is checked before the content is looked at,
 * only JPEG, PNG and WebP are accepted, and the result is a full (1600 px) and a thumbnail (320 px)
 * WebP. The row and its audit entry are written in one transaction; the uploaded objects are
 * deleted again when anything fails.
 */
export async function addTemplate(
	actor: SessionUser,
	name: string,
	file: Buffer
): Promise<{ id: string }> {
	assertAdmin(actor);
	const cleaned = cleanName(name);
	if (file.length > env.AVATAR_MAX_MB * 1024 * 1024) throw new TemplateError('size');
	const sniffed = await sniffMedia(file);
	if (!sniffed || !ACCEPTED_MIME.has(sniffed.mime)) throw new TemplateError('type');

	let full: Buffer;
	let thumb: Buffer;
	let width: number;
	let height: number;
	try {
		const processed = await sharp(file)
			.rotate()
			.resize(inside(TEMPLATE_MAX_SIDE))
			.webp({ quality: FULL_QUALITY })
			.toBuffer({ resolveWithObject: true });
		full = processed.data;
		width = processed.info.width;
		height = processed.info.height;
		// the small copy comes from the already reduced image: the input is decoded only once
		thumb = await sharp(full)
			.resize(inside(TEMPLATE_THUMB_SIDE))
			.webp({ quality: THUMB_QUALITY })
			.toBuffer();
	} catch {
		throw new TemplateError('process');
	}

	const { key: objectKey, thumbKey } = templateKeys();
	const uploaded: string[] = [];
	try {
		// register before awaiting: a PUT that fails midway may still have left the object behind
		uploaded.push(objectKey);
		await putObject(objectKey, full, 'image/webp');
		uploaded.push(thumbKey);
		await putObject(thumbKey, thumb, 'image/webp');

		return await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(templates)
				.values({ name: cleaned, objectKey, thumbKey, width, height, createdBy: actor.id })
				.returning({ id: templates.id, publicId: templates.publicId });
			await audit(
				actor.id,
				AUDIT_ACTIONS.templateAdded,
				'template',
				row.id,
				`name="${cleaned}" key=${objectKey}`,
				tx
			);
			return { id: row.publicId };
		});
	} catch (e) {
		await deleteQuietly(uploaded);
		throw e;
	}
}

/** The internal id of a public id; notfound when it does not exist. */
async function resolveOrThrow(pid: string): Promise<number> {
	const id = await resolveTemplateId(pid);
	if (id === null) throw new TemplateError('notfound');
	return id;
}

/** Locks the template row (removed ones included) and returns its name; notfound when unknown. */
async function lockedName(tx: Tx, id: number, removed?: boolean) {
	const [row] = await tx
		.select({ name: templates.name })
		.from(templates)
		.where(
			and(
				eq(templates.id, id),
				removed === undefined
					? undefined
					: removed
						? isNotNull(templates.removedAt)
						: isNull(templates.removedAt)
			)
		)
		.for('update');
	if (!row) throw new TemplateError('notfound');
	return row.name;
}

/** Renames a template, removed ones included (admins only). */
export async function renameTemplate(actor: SessionUser, pid: string, name: string): Promise<void> {
	assertAdmin(actor);
	const cleaned = cleanName(name);
	const id = await resolveOrThrow(pid);
	await db.transaction(async (tx) => {
		const from = await lockedName(tx, id);
		await tx.update(templates).set({ name: cleaned }).where(eq(templates.id, id));
		await audit(
			actor.id,
			AUDIT_ACTIONS.templateRenamed,
			'template',
			id,
			`from="${from}" to="${cleaned}"`,
			tx
		);
	});
}

/** Soft delete: the row and its files stay so memes made from it keep their provenance. */
export async function removeTemplate(actor: SessionUser, pid: string): Promise<void> {
	assertAdmin(actor);
	const id = await resolveOrThrow(pid);
	await db.transaction(async (tx) => {
		const name = await lockedName(tx, id, false);
		await tx.update(templates).set({ removedAt: new Date() }).where(eq(templates.id, id));
		await audit(actor.id, AUDIT_ACTIONS.templateRemoved, 'template', id, `name="${name}"`, tx);
	});
}

/** Brings a removed template back (admins only). */
export async function restoreTemplate(actor: SessionUser, pid: string): Promise<void> {
	assertAdmin(actor);
	const id = await resolveOrThrow(pid);
	await db.transaction(async (tx) => {
		const name = await lockedName(tx, id, true);
		await tx.update(templates).set({ removedAt: null }).where(eq(templates.id, id));
		await audit(actor.id, AUDIT_ACTIONS.templateRestored, 'template', id, `name="${name}"`, tx);
	});
}

const usageCount = sql<number>`count(${media.id})::int`;

function templateRows(where?: ReturnType<typeof and>) {
	return db
		.select({
			id: templates.publicId,
			name: templates.name,
			objectKey: templates.objectKey,
			thumbKey: templates.thumbKey,
			width: templates.width,
			height: templates.height,
			usageCount,
			removedAt: templates.removedAt
		})
		.from(templates)
		.leftJoin(media, eq(media.templateId, templates.id))
		.where(where)
		.groupBy(templates.id)
		.orderBy(
			sql`${templates.removedAt} IS NOT NULL`,
			desc(usageCount),
			asc(templates.name),
			asc(templates.id)
		);
}

const toRow = (r: Awaited<ReturnType<typeof templateRows>>[number]): TemplateRow => ({
	...r,
	removedAt: r.removedAt ? r.removedAt.toISOString() : null
});

/** Active templates by usage (most used first), then name; removed ones appended when asked for. */
export async function listTemplates(
	opts: { includeRemoved?: boolean } = {}
): Promise<TemplateRow[]> {
	const rows = await templateRows(opts.includeRemoved ? undefined : isNull(templates.removedAt));
	return rows.map(toRow);
}

/** One active template; null when unknown or removed (removed ones only with `includeRemoved`). */
export async function getTemplate(
	pid: string,
	opts: { includeRemoved?: boolean } = {}
): Promise<TemplateRow | null> {
	const [row] = await templateRows(
		opts.includeRemoved
			? eq(templates.publicId, pid)
			: and(eq(templates.publicId, pid), isNull(templates.removedAt))
	);
	return row ? toRow(row) : null;
}
