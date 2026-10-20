import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

export const client = postgres(env.DATABASE_URL);
export const db = drizzle(client, { schema });

/** Applies pending migrations from ./drizzle. Call once at server start. */
export async function runMigrations(): Promise<void> {
	await migrate(db, { migrationsFolder: 'drizzle' });
}
