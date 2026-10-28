import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from './db';
import { comments, media, quotes, templates, users } from './db/schema';

import { isPublicId } from '../public-id';

// The validator is client-safe and lives in `$lib/public-id`; re-exported for server callers.
export { isPublicId, PUBLIC_ID_RE } from '../public-id';

type Keyed = PgTable & { id: PgColumn; publicId: PgColumn };

/** One indexed lookup; an invalid shape never reaches the database. */
async function resolve(table: Keyed, pid: string): Promise<number | null> {
	if (!isPublicId(pid)) return null;
	const [row] = await db
		.select({ id: table.id })
		.from(table as PgTable)
		.where(eq(table.publicId, pid))
		.limit(1);
	return (row?.id as number | undefined) ?? null;
}

export const resolveMediaId = (pid: string) => resolve(media, pid);
export const resolveUserId = (pid: string) => resolve(users, pid);
export const resolveCommentId = (pid: string) => resolve(comments, pid);
export const resolveQuoteId = (pid: string) => resolve(quotes, pid);
export const resolveTemplateId = (pid: string) => resolve(templates, pid);

export async function publicIdOfMedia(id: number): Promise<string | null> {
	const [row] = await db
		.select({ publicId: media.publicId })
		.from(media)
		.where(eq(media.id, id))
		.limit(1);
	return row?.publicId ?? null;
}

export async function publicIdOfUser(id: number): Promise<string | null> {
	const [row] = await db
		.select({ publicId: users.publicId })
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	return row?.publicId ?? null;
}
