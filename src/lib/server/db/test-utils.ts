import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { db, runMigrations } from './index';
import * as schema from './schema';
import { users } from './schema';

let counter = 0;

/** Brings the test database schema up to date. Call in beforeAll. */
export async function setupDb(): Promise<void> {
	await runMigrations();
}

/** Truncates every table and restarts identity sequences. */
export async function resetDb(): Promise<void> {
	const names = Object.values(schema)
		.filter((v) => is(v, PgTable))
		.map((t) => `"${getTableName(t as PgTable)}"`);
	await db.execute(sql.raw(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`));
}

/** Inserts and returns a user with a unique `sub`. */
export async function testUser(overrides: Partial<typeof users.$inferInsert> = {}) {
	counter += 1;
	const [user] = await db
		.insert(users)
		.values({
			sub: `test-sub-${Date.now()}-${counter}`,
			username: `user${counter}`,
			role: 'member',
			...overrides
		})
		.returning();
	return user;
}
