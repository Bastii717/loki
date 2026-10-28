import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import { quotes } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { insertQuoteRow, userWithSession } from '../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../lib/server/rate-limit';
import { callRoute } from '../../../lib/server/test-request';
import { DELETE as deleteQuote } from './[pid]/+server';
import { POST as voteQuote } from './[pid]/vote/+server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

async function world() {
	const owner = await userWithSession('member');
	const mod = await userWithSession('moderator');
	const quote = await insertQuoteRow(owner.user.id);
	return { owner, mod, quote };
}

const unusable = (internalId: number) => [
	String(internalId),
	'1',
	'abc',
	'AAAAAAAAAAAA',
	'AAAAAAAAAAAAA'
];

describe('POST /api/quotes/[pid]/vote', () => {
	it('votes by public id', async () => {
		const { owner, quote } = await world();
		const { response } = await callRoute({
			handler: voteQuote,
			path: `/api/quotes/${quote.publicId}/vote`,
			method: 'POST',
			params: { pid: quote.publicId },
			body: { value: 1 },
			session: owner.session
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ score: 1, userVote: 1 });
	});

	it('answers 404 for the internal id, junk and unknown public ids', async () => {
		const { owner, quote } = await world();
		for (const pid of unusable(quote.id)) {
			const { response } = await callRoute({
				handler: voteQuote,
				path: `/api/quotes/${pid}/vote`,
				method: 'POST',
				params: { pid },
				body: { value: 1 },
				session: owner.session
			});
			expect(response.status, pid).toBe(404);
		}
	});
});

describe('DELETE /api/quotes/[pid]', () => {
	it('deletes by public id for a moderator', async () => {
		const { mod, quote } = await world();
		const { response } = await callRoute({
			handler: deleteQuote,
			path: `/api/quotes/${quote.publicId}`,
			method: 'DELETE',
			params: { pid: quote.publicId },
			session: mod.session
		});
		expect(response.status).toBe(204);
		expect(await db.select().from(quotes).where(eq(quotes.id, quote.id))).toHaveLength(0);
	});

	it('answers 404 for the internal id, junk and unknown public ids', async () => {
		const { mod, quote } = await world();
		for (const pid of unusable(quote.id)) {
			const { response } = await callRoute({
				handler: deleteQuote,
				path: `/api/quotes/${pid}`,
				method: 'DELETE',
				params: { pid },
				session: mod.session
			});
			expect(response.status, pid).toBe(404);
		}
		expect(await db.select().from(quotes)).toHaveLength(1);
	});

	it('forbids a member (403)', async () => {
		const { owner, quote } = await world();
		const { response } = await callRoute({
			handler: deleteQuote,
			path: `/api/quotes/${quote.publicId}`,
			method: 'DELETE',
			params: { pid: quote.publicId },
			session: owner.session
		});
		expect(response.status).toBe(403);
	});
});
