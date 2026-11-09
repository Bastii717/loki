import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { mentionNames, resolveMentions, TooManyMentionsError } from './mentions';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

describe('server mentions', () => {
	it('mentionNames returns board names and omits unknown ids', async () => {
		const a = await testUser({ displayName: 'Lena K.' });
		const b = await testUser();
		const names = await mentionNames([a.publicId, b.publicId, 'zzzzzzzzzzzz']);
		expect(names).toEqual({ [a.publicId]: 'Lena K.', [b.publicId]: b.username });
	});

	it('mentionNames of nothing is empty', async () => {
		expect(await mentionNames([])).toEqual({});
	});

	it('resolveMentions returns only existing members', async () => {
		const a = await testUser();
		const res = await resolveMentions(`hi @[u:${a.publicId}] @[u:zzzzzzzzzzzz] @[u:${a.publicId}]`);
		expect(res).toEqual([{ userId: a.id, publicId: a.publicId }]);
	});

	it('mention_text substitutes names in SQL', async () => {
		const a = await testUser({ displayName: 'Lena K.' });
		const [{ t }] = await db.execute<{ t: string }>(
			sql`SELECT mention_text(${`x @[u:${a.publicId}] @[u:zzzzzzzzzzzz]`}) AS t`
		);
		expect(t).toBe('x @Lena K. @unknown member');
	});

	it('TooManyMentionsError has the spec message', () => {
		expect(new TooManyMentionsError().message).toBe('A comment can mention at most 5 members');
	});
});
