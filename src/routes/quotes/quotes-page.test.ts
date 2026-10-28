import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { insertQuoteRow, userWithSession } from '../../lib/server/moderation-test-utils';
import { load } from './+page.server';

beforeAll(setupDb);
beforeEach(resetDb);

describe('quotes page load', () => {
	it('carries public ids only', async () => {
		const member = await userWithSession();
		const quote = await insertQuoteRow(member.user.id, 'Hello');
		const data = (await load({ locals: { user: member.user } } as never)) as {
			quotes: { id: string }[];
		};
		expect(data.quotes.map((q) => q.id)).toEqual([quote.publicId]);
		expect(JSON.stringify(data)).not.toMatch(/"id":\d/);
	});
});

describe('quotes page', () => {
	it('addresses the API by the quote id it was given', () => {
		const source = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
		expect(source).toContain('`/api/quotes/${id}/vote`');
		expect(source).toContain('`/api/quotes/${id}`');
		expect(source).toContain('vote(q.id, 1)');
		expect(source).toContain('remove(q.id)');
	});
});
