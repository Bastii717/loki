import { inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { users } from './db/schema';
import { mentionIds } from '../mentions';

export class TooManyMentionsError extends Error {
	constructor() {
		super('A comment can mention at most 5 members');
	}
}

/** Public id → board name (display name, else username). Unknown ids are absent. */
export async function mentionNames(ids: string[]): Promise<Record<string, string>> {
	if (ids.length === 0) return {};
	const rows = await db
		.select({
			publicId: users.publicId,
			name: sql<string>`coalesce(${users.displayName}, ${users.username})`
		})
		.from(users)
		.where(inArray(users.publicId, ids));
	return Object.fromEntries(rows.map((r) => [r.publicId, r.name]));
}

/** The existing members mentioned in `text`, one entry per distinct token. */
export async function resolveMentions(
	text: string
): Promise<{ userId: number; publicId: string }[]> {
	const ids = mentionIds(text);
	if (ids.length === 0) return [];
	const rows = await db
		.select({ userId: users.id, publicId: users.publicId })
		.from(users)
		.where(inArray(users.publicId, ids));
	const order = new Map(ids.map((id, i) => [id, i]));
	return rows.sort((a, b) => order.get(a.publicId)! - order.get(b.publicId)!);
}
