import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb, testUser } from './db/test-utils';
import {
	addQuote,
	deleteQuote,
	listQuotes,
	QuoteNotFoundError,
	QuotePermissionError,
	QuoteTextError,
	voteQuote
} from './quotes';
import { addOpenReports, OVER_THRESHOLD, timeOut } from './moderation-test-utils';
import { env } from './env';
import { resolveReports, TimeoutActiveError } from './moderation';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const asSession = (u: { id: number; username: string; role: string }) =>
	({ id: u.id, username: u.username, displayName: null, role: u.role }) as Parameters<
		typeof deleteQuote
	>[0];

describe('addQuote / listQuotes', () => {
	it('adds trimmed quotes and lists newest first with score and own vote', async () => {
		const u = await testUser();
		const a = await addQuote(u.id, '  Erstes  ', ' Opa ');
		const b = await addQuote(u.id, 'Zweites', 'Oma');
		expect(a).toMatchObject({ text: 'Erstes', author: 'Opa', score: 0, userVote: 0 });
		const list = await listQuotes(u.id);
		expect(list.map((q) => q.id)).toEqual([b.id, a.id]);
	});

	it("flags the viewer's own quotes as mine (report entry is never offered on them)", async () => {
		const owner = await testUser();
		const other = await testUser();
		await addQuote(owner.id, 'Meins', 'Opa');
		expect((await listQuotes(owner.id))[0].mine).toBe(true);
		expect((await listQuotes(other.id))[0].mine).toBe(false);
	});

	it('rejects empty and over-long text or author', async () => {
		const u = await testUser();
		await expect(addQuote(u.id, '   ', 'x')).rejects.toBeInstanceOf(QuoteTextError);
		await expect(addQuote(u.id, 'x', '')).rejects.toBeInstanceOf(QuoteTextError);
		await expect(addQuote(u.id, 'x'.repeat(501), 'x')).rejects.toBeInstanceOf(QuoteTextError);
		await expect(addQuote(u.id, 'x', 'y'.repeat(101))).rejects.toBeInstanceOf(QuoteTextError);
		await expect(addQuote(u.id, 'x'.repeat(500), 'y'.repeat(100))).resolves.toBeDefined();
	});
});

describe('voteQuote', () => {
	it('computes the score by aggregate across users, with toggle and switch', async () => {
		const u1 = await testUser();
		const u2 = await testUser();
		const q = await addQuote(u1.id, 't', 'a');
		expect(await voteQuote(u1.id, q.id, 1)).toEqual({ score: 1, userVote: 1 });
		expect(await voteQuote(u2.id, q.id, 1)).toEqual({ score: 2, userVote: 1 });
		expect(await voteQuote(u2.id, q.id, -1)).toEqual({ score: 0, userVote: -1 });
		expect(await voteQuote(u1.id, q.id, 0)).toEqual({ score: -1, userVote: 0 });
		const list = await listQuotes(u2.id);
		expect(list[0]).toMatchObject({ score: -1, userVote: -1 });
		expect((await listQuotes(u1.id))[0].userVote).toBe(0);
	});

	it('throws for an unknown quote', async () => {
		const u = await testUser();
		await expect(voteQuote(u.id, 999999, 1)).rejects.toBeInstanceOf(QuoteNotFoundError);
	});
});

describe('deleteQuote', () => {
	it('forbids members, even the submitter', async () => {
		const u = await testUser();
		const q = await addQuote(u.id, 't', 'a');
		await expect(deleteQuote(asSession(u), q.id)).rejects.toBeInstanceOf(QuotePermissionError);
		expect(await listQuotes(u.id)).toHaveLength(1);
	});

	it('lets moderators and admins delete, cascading votes', async () => {
		const u = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const admin = await testUser({ role: 'admin' });
		const q1 = await addQuote(u.id, 't', 'a');
		const q2 = await addQuote(u.id, 't2', 'a');
		await voteQuote(u.id, q1.id, 1);
		await deleteQuote(asSession(mod), q1.id);
		await deleteQuote(asSession(admin), q2.id);
		expect(await listQuotes(u.id)).toHaveLength(0);
	});

	it("refuses a timed-out moderator on someone else's quote, allows their own", async () => {
		const u = await testUser();
		const mod = await testUser({ role: 'moderator' });
		const admin = await testUser({ role: 'admin' });
		const foreign = await addQuote(u.id, 'fremd', 'a');
		const own = await addQuote(mod.id, 'eigen', 'a');
		await timeOut(mod.id, admin.id);
		await expect(deleteQuote(asSession(mod), foreign.id)).rejects.toBeInstanceOf(
			TimeoutActiveError
		);
		await deleteQuote(asSession(mod), own.id);
		expect((await listQuotes(u.id)).map((q) => q.id)).toEqual([foreign.id]);
	});

	it('throws not-found for a missing quote', async () => {
		const mod = await testUser({ role: 'moderator' });
		await expect(deleteQuote(asSession(mod), 999999)).rejects.toBeInstanceOf(QuoteNotFoundError);
	});
});

describe('listQuotes under review', () => {
	it('nulls text (and author) of an over-threshold quote for members; mods see it flagged', async () => {
		const u = await testUser();
		const fine = await addQuote(u.id, 'ok', 'Opa');
		const bad = await addQuote(u.id, 'boese', 'Opa Hitler');
		await addOpenReports('quote', bad.id, u.id, OVER_THRESHOLD);

		const member = await listQuotes(u.id);
		expect(member.find((q) => q.id === fine.id)).toMatchObject({ text: 'ok', underReview: false });
		expect(member.find((q) => q.id === bad.id)).toMatchObject({
			text: null,
			author: '',
			underReview: true
		});
		expect(JSON.stringify(member)).not.toContain('boese');
		expect(JSON.stringify(member)).not.toContain('Hitler');

		const mod = await listQuotes(u.id, true);
		expect(mod.find((q) => q.id === bad.id)).toMatchObject({
			text: 'boese',
			author: 'Opa Hitler',
			underReview: true
		});
	});

	it('exactly at the threshold the quote is visible; a released quote stays visible', async () => {
		const u = await testUser();
		const q = await addQuote(u.id, 'grenzfall', 'Oma');
		await addOpenReports('quote', q.id, u.id, env.REPORT_REVIEW_THRESHOLD);
		expect((await listQuotes(u.id))[0]).toMatchObject({ text: 'grenzfall', underReview: false });

		await addOpenReports('quote', q.id, u.id, 1);
		expect((await listQuotes(u.id))[0]).toMatchObject({ text: null, underReview: true });

		const mod = await testUser({ role: 'moderator' });
		await resolveReports(
			{ id: mod.id, username: mod.username, displayName: null, role: 'moderator' },
			'quote',
			q.id,
			'dismissed'
		);
		await addOpenReports('quote', q.id, u.id, OVER_THRESHOLD);
		expect((await listQuotes(u.id))[0]).toMatchObject({ text: 'grenzfall', underReview: false });
	});
});
