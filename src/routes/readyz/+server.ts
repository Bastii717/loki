import { json } from '@sveltejs/kit';
import { getReadiness } from '../../lib/server/readiness';
import type { RequestHandler } from './$types';

/** Readiness probe: 200 once the database, the migrations and the storage are all usable. Booleans only. */
export const GET: RequestHandler = async () => {
	const { db, migrated, storage } = await getReadiness();
	const ready = db && migrated && storage;
	return json(
		{ ready, db, migrated, storage },
		{ status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
