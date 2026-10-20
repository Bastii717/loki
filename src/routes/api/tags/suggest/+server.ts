import { json } from '@sveltejs/kit';
import { asc, like } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { tags } from '#lib/server/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().replace(/^#/, '');
	if (q === '' || q.length > 30) return json({ tags: [] });
	// tags are stored lowercase; escape LIKE wildcards so the query is a literal prefix
	const prefix = q.replace(/[\\%_]/g, (c) => `\\${c}`);
	const rows = await db
		.select({ name: tags.name })
		.from(tags)
		.where(like(tags.name, `${prefix}%`))
		.orderBy(asc(tags.name))
		.limit(10);
	return json({ tags: rows.map((r) => r.name) });
};
