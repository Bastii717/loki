import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import { tags } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { GET } from './suggest/+server';

const call = async (q?: string) => {
	const url = new URL('http://localhost/api/tags/suggest');
	if (q !== undefined) url.searchParams.set('q', q);
	const res = await GET({ url } as Parameters<typeof GET>[0]);
	return res.json();
};

beforeAll(setupDb);
beforeEach(resetDb);

describe('GET /api/tags/suggest', () => {
	it('returns prefix matches, case-insensitive, capped at 10', async () => {
		await db
			.insert(tags)
			.values([
				...Array.from({ length: 12 }, (_, i) => ({ name: `kat${String(i).padStart(2, '0')}` })),
				{ name: 'hund' }
			]);
		const { tags: found } = await call('#KAT');
		expect(found).toHaveLength(10);
		expect(found.every((t: string) => t.startsWith('kat'))).toBe(true);
		expect((await call('hu')).tags).toEqual(['hund']);
	});

	it('treats LIKE wildcards literally and returns nothing for empty q', async () => {
		await db.insert(tags).values([{ name: 'abc' }]);
		expect((await call('%')).tags).toEqual([]);
		expect((await call('_')).tags).toEqual([]);
		expect((await call('')).tags).toEqual([]);
		expect((await call()).tags).toEqual([]);
	});
});
