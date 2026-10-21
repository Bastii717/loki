import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { auditLog, comments, media, quotes, reports, timeouts } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { env } from './env';
import {
	activeTimeout,
	assertNotTimedOut,
	audit,
	createReport,
	isUnderReview,
	liftTimeout,
	listAudit,
	openReportCount,
	ReportError,
	resolveReports,
	setTimeout_,
	TimeoutActionError,
	TimeoutActiveError
} from './moderation';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

async function userWithRole(role: SessionUser['role'] = 'member'): Promise<SessionUser> {
	const u = await testUser({ role });
	return { id: u.id, username: u.username, role };
}

async function addMeme(uploaderId: number, title = 'm'): Promise<number> {
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title,
			kind: 'image',
			objectKey: 'memes/o.webp',
			thumbKey: 'memes/t.webp'
		})
		.returning({ id: media.id });
	return row.id;
}

async function addComment(authorId: number, mediaId: number, text: string): Promise<number> {
	const [row] = await db
		.insert(comments)
		.values({ authorId, mediaId, text })
		.returning({ id: comments.id });
	return row.id;
}

async function addQuote(submittedBy: number | null, text: string): Promise<number> {
	const [row] = await db
		.insert(quotes)
		.values({ submittedBy, text, author: 'x' })
		.returning({ id: quotes.id });
	return row.id;
}

const HOUR = 3_600_000;

async function insertTimeout(
	userId: number,
	setBy: number,
	until: Date,
	extra: Partial<typeof timeouts.$inferInsert> = {}
) {
	await db.insert(timeouts).values({ userId, setBy, reason: 'r', until, ...extra });
}

async function expectReportError(p: Promise<unknown>, code: string) {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(ReportError);
	expect((err as ReportError).code).toBe(code);
}

async function expectTimeoutError(p: Promise<unknown>, code: string) {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(TimeoutActionError);
	expect((err as TimeoutActionError).code).toBe(code);
}

async function auditActions(): Promise<string[]> {
	const rows = await db.select().from(auditLog).orderBy(auditLog.id);
	return rows.map((r) => r.action);
}

/** n distinct members each reporting the content. */
async function reportBy(
	n: number,
	contentType: 'meme' | 'comment' | 'quote',
	contentId: number
): Promise<SessionUser[]> {
	const reporters: SessionUser[] = [];
	for (let i = 0; i < n; i++) {
		const r = await userWithRole();
		await createReport(r, contentType, contentId, 'spam');
		reporters.push(r);
	}
	return reporters;
}

describe('createReport', () => {
	it('stores author and a title excerpt for a meme, falling back to "Meme #id"', async () => {
		const author = await userWithRole();
		const reporter = await userWithRole();
		const titled = await addMeme(author.id, 'Lustiger Titel');
		const untitled = await addMeme(author.id, '');
		await createReport(reporter, 'meme', titled, 'verletzend', ' bitte prüfen ');
		await createReport(reporter, 'meme', untitled, 'spam');
		const rows = await db.select().from(reports).orderBy(reports.id);
		expect(rows[0]).toMatchObject({
			contentType: 'meme',
			contentId: titled,
			reporterId: reporter.id,
			authorId: author.id,
			category: 'verletzend',
			text: 'bitte prüfen',
			excerpt: 'Lustiger Titel',
			status: 'open',
			outcome: null
		});
		expect(rows[1].excerpt).toBe(`Meme #${untitled}`);
	});

	it('snapshots the first 200 characters for comments and quotes', async () => {
		const author = await userWithRole();
		const reporter = await userWithRole();
		const long = 'a'.repeat(150) + 'b'.repeat(150);
		const memeId = await addMeme(author.id);
		const commentId = await addComment(author.id, memeId, long);
		const quoteId = await addQuote(author.id, long);
		await createReport(reporter, 'comment', commentId, 'spam');
		await createReport(reporter, 'quote', quoteId, 'spam');
		const rows = await db.select().from(reports).orderBy(reports.id);
		expect(rows[0]).toMatchObject({ contentType: 'comment', authorId: author.id });
		expect(rows[0].excerpt).toBe(long.slice(0, 200));
		expect(rows[1]).toMatchObject({ contentType: 'quote', authorId: author.id });
		expect(rows[1].excerpt).toBe(long.slice(0, 200));
	});

	it('rejects own content of every type', async () => {
		const me = await userWithRole();
		const memeId = await addMeme(me.id);
		const commentId = await addComment(me.id, memeId, 't');
		const quoteId = await addQuote(me.id, 't');
		await expectReportError(createReport(me, 'meme', memeId, 'spam'), 'own');
		await expectReportError(createReport(me, 'comment', commentId, 'spam'), 'own');
		await expectReportError(createReport(me, 'quote', quoteId, 'spam'), 'own');
		expect(await db.select().from(reports)).toHaveLength(0);
	});

	it('rejects unknown content of every type', async () => {
		const me = await userWithRole();
		await expectReportError(createReport(me, 'meme', 999, 'spam'), 'notfound');
		await expectReportError(createReport(me, 'comment', 999, 'spam'), 'notfound');
		await expectReportError(createReport(me, 'quote', 999, 'spam'), 'notfound');
	});

	it('rejects a quote without a submitter (nobody to attribute the report to)', async () => {
		const me = await userWithRole();
		const quoteId = await addQuote(null, 'anonym');
		await expectReportError(createReport(me, 'quote', quoteId, 'spam'), 'unreportable');
	});

	it('rejects a duplicate open report, but allows another reporter and a re-report after resolution', async () => {
		const author = await userWithRole();
		const a = await userWithRole();
		const b = await userWithRole();
		const mod = await userWithRole('moderator');
		const id = await addMeme(author.id);
		await createReport(a, 'meme', id, 'spam');
		await expectReportError(createReport(a, 'meme', id, 'verletzend'), 'duplicate');
		await createReport(b, 'meme', id, 'spam');
		await resolveReports(mod, 'meme', id, 'actioned');
		await createReport(a, 'meme', id, 'spam');
		expect(await db.select().from(reports)).toHaveLength(3);
	});

	it('rejects an invalid category or an over-long text', async () => {
		const author = await userWithRole();
		const r = await userWithRole();
		const id = await addMeme(author.id);
		await expectReportError(createReport(r, 'meme', id, 'bogus' as never), 'invalid');
		await expectReportError(createReport(r, 'meme', id, 'spam', 'x'.repeat(501)), 'invalid');
		await createReport(r, 'meme', id, 'spam', 'x'.repeat(500));
		expect(await db.select().from(reports)).toHaveLength(1);
	});

	it('rejects a timed-out reporter with TimeoutActiveError', async () => {
		const author = await userWithRole();
		const r = await userWithRole();
		const id = await addMeme(author.id);
		const until = new Date(Date.now() + HOUR);
		await insertTimeout(r.id, author.id, until);
		await expect(createReport(r, 'meme', id, 'spam')).rejects.toBeInstanceOf(TimeoutActiveError);
		expect(await db.select().from(reports)).toHaveLength(0);
	});
});

describe('activeTimeout / assertNotTimedOut', () => {
	it('is null without timeouts, with expired ones, and with lifted ones', async () => {
		const mod = await userWithRole('moderator');
		const u = await userWithRole();
		expect(await activeTimeout(u.id)).toBeNull();
		await insertTimeout(u.id, mod.id, new Date(Date.now() - HOUR));
		await insertTimeout(u.id, mod.id, new Date(Date.now() + HOUR), {
			liftedAt: new Date(),
			liftedBy: mod.id
		});
		expect(await activeTimeout(u.id)).toBeNull();
		await expect(assertNotTimedOut(u)).resolves.toBeUndefined();
	});

	it('returns until and reason of the active timeout and throws TimeoutActiveError with them', async () => {
		const mod = await userWithRole('moderator');
		const u = await userWithRole();
		const until = new Date(Date.now() + HOUR);
		await insertTimeout(u.id, mod.id, until, { reason: 'Spam' });
		expect(await activeTimeout(u.id)).toEqual({ until, reason: 'Spam' });
		const err = await assertNotTimedOut(u).then(
			() => null,
			(e: unknown) => e
		);
		expect(err).toBeInstanceOf(TimeoutActiveError);
		expect((err as TimeoutActiveError).until).toEqual(until);
		expect((err as TimeoutActiveError).reason).toBe('Spam');
	});
});

describe('openReportCount / isUnderReview', () => {
	it('counts distinct open reporters only', async () => {
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const id = await addMeme(author.id);
		const [first] = await reportBy(2, 'meme', id);
		expect(await openReportCount('meme', id)).toBe(2);
		// a second open row from the same reporter (legacy / race) still counts once
		await db.insert(reports).values({
			contentType: 'meme',
			contentId: id,
			reporterId: first.id,
			authorId: author.id,
			category: 'spam',
			excerpt: 'x'
		});
		expect(await openReportCount('meme', id)).toBe(2);
		await resolveReports(mod, 'meme', id, 'actioned');
		expect(await openReportCount('meme', id)).toBe(0);
	});

	it('does not mix content types or ids', async () => {
		const author = await userWithRole();
		const memeId = await addMeme(author.id);
		const commentId = await addComment(author.id, memeId, 't');
		await reportBy(2, 'meme', memeId);
		expect(await openReportCount('comment', commentId)).toBe(0);
		expect(await openReportCount('meme', memeId + 1)).toBe(0);
	});

	it('excludes reporters with an active timeout, but not expired or lifted ones', async () => {
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const id = await addMeme(author.id);
		const [r1, r2, r3, r4] = await reportBy(4, 'meme', id);
		await insertTimeout(r1.id, mod.id, new Date(Date.now() + HOUR));
		await insertTimeout(r2.id, mod.id, new Date(Date.now() - HOUR));
		await insertTimeout(r3.id, mod.id, new Date(Date.now() + HOUR), {
			liftedAt: new Date(),
			liftedBy: mod.id
		});
		expect(r4).toBeDefined();
		expect(await openReportCount('meme', id)).toBe(3);
	});

	it('flips exactly above the threshold (strictly greater)', async () => {
		const threshold = env.REPORT_REVIEW_THRESHOLD;
		const author = await userWithRole();
		const id = await addMeme(author.id);
		await reportBy(threshold, 'meme', id);
		expect(await openReportCount('meme', id)).toBe(threshold);
		expect(await isUnderReview('meme', id)).toBe(false);
		await reportBy(1, 'meme', id);
		expect(await isUnderReview('meme', id)).toBe(true);
	});

	it('does not count timed-out reporters towards the threshold', async () => {
		const threshold = env.REPORT_REVIEW_THRESHOLD;
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const id = await addMeme(author.id);
		const reporters = await reportBy(threshold + 1, 'meme', id);
		expect(await isUnderReview('meme', id)).toBe(true);
		await insertTimeout(reporters[0].id, mod.id, new Date(Date.now() + HOUR));
		expect(await isUnderReview('meme', id)).toBe(false);
	});

	it('works for comments and quotes', async () => {
		const author = await userWithRole();
		const memeId = await addMeme(author.id);
		const commentId = await addComment(author.id, memeId, 't');
		const quoteId = await addQuote(author.id, 't');
		await reportBy(env.REPORT_REVIEW_THRESHOLD + 1, 'comment', commentId);
		await reportBy(env.REPORT_REVIEW_THRESHOLD + 1, 'quote', quoteId);
		expect(await isUnderReview('comment', commentId)).toBe(true);
		expect(await isUnderReview('quote', quoteId)).toBe(true);
		expect(await isUnderReview('meme', memeId)).toBe(false);
	});

	it('is never under review once reviewedAt is set, even with fresh reports', async () => {
		const author = await userWithRole();
		const id = await addMeme(author.id);
		await db.update(media).set({ reviewedAt: new Date() }).where(eq(media.id, id));
		await reportBy(env.REPORT_REVIEW_THRESHOLD + 2, 'meme', id);
		expect(await isUnderReview('meme', id)).toBe(false);
	});

	it('is false for unknown content', async () => {
		expect(await isUnderReview('meme', 12345)).toBe(false);
	});
});

describe('setTimeout_ permission matrix', () => {
	const roles = ['member', 'moderator', 'admin'] as const;
	// actor role -> target role -> allowed
	const allowed: Record<string, Record<string, boolean>> = {
		member: { member: false, moderator: false, admin: false },
		moderator: { member: true, moderator: false, admin: false },
		admin: { member: true, moderator: true, admin: true }
	};

	for (const actorRole of roles) {
		for (const targetRole of roles) {
			it(`${actorRole} -> ${targetRole}: ${allowed[actorRole][targetRole] ? 'allowed' : 'forbidden'}`, async () => {
				const actor = await userWithRole(actorRole);
				const target = await userWithRole(targetRole);
				const run = setTimeout_(actor, target.id, 3, 'Grund');
				if (allowed[actorRole][targetRole]) {
					await run;
					expect(await activeTimeout(target.id)).not.toBeNull();
					expect(await auditActions()).toEqual(['timeout_set']);
				} else {
					await expectTimeoutError(run, 'forbidden');
					expect(await activeTimeout(target.id)).toBeNull();
					expect(await auditActions()).toEqual([]);
				}
			});
		}
	}

	it('nobody may time themselves out, not even an admin', async () => {
		for (const role of roles) {
			const me = await userWithRole(role);
			await expectTimeoutError(setTimeout_(me, me.id, 1, 'x'), 'self');
			await expectTimeoutError(liftTimeout(me, me.id), 'self');
			expect(await activeTimeout(me.id)).toBeNull();
		}
	});

	it('rejects an unknown target user', async () => {
		const mod = await userWithRole('moderator');
		await expectTimeoutError(setTimeout_(mod, 99999, 1, 'x'), 'notfound');
	});

	it('validates days (integer 1-30) and reason (1-500 chars)', async () => {
		const mod = await userWithRole('moderator');
		const u = await userWithRole();
		for (const days of [0, -1, 31, 1.5, NaN]) {
			await expectTimeoutError(setTimeout_(mod, u.id, days, 'x'), 'invalid');
		}
		await expectTimeoutError(setTimeout_(mod, u.id, 1, ''), 'invalid');
		await expectTimeoutError(setTimeout_(mod, u.id, 1, '   '), 'invalid');
		await expectTimeoutError(setTimeout_(mod, u.id, 1, 'x'.repeat(501)), 'invalid');
		expect(await activeTimeout(u.id)).toBeNull();
		await setTimeout_(mod, u.id, 30, 'x'.repeat(500));
		expect(await activeTimeout(u.id)).not.toBeNull();
	});

	it('sets until to now + days', async () => {
		const mod = await userWithRole('moderator');
		const u = await userWithRole();
		const before = Date.now();
		await setTimeout_(mod, u.id, 7, 'Grund');
		const active = await activeTimeout(u.id);
		const expected = before + 7 * 24 * HOUR;
		expect(active!.until.getTime()).toBeGreaterThanOrEqual(expected);
		expect(active!.until.getTime()).toBeLessThan(expected + 10_000);
		expect(active!.reason).toBe('Grund');
	});

	it('replaces an active timeout: old row lifted by the actor, new row active, both audited', async () => {
		const mod = await userWithRole('moderator');
		const admin = await userWithRole('admin');
		const u = await userWithRole();
		await setTimeout_(mod, u.id, 2, 'erst');
		await setTimeout_(admin, u.id, 10, 'dann');
		const rows = await db
			.select()
			.from(timeouts)
			.where(eq(timeouts.userId, u.id))
			.orderBy(timeouts.id);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ liftedBy: admin.id, setBy: mod.id, reason: 'erst' });
		expect(rows[0].liftedAt).toBeInstanceOf(Date);
		expect(rows[1]).toMatchObject({
			liftedBy: null,
			liftedAt: null,
			setBy: admin.id,
			reason: 'dann'
		});
		expect((await activeTimeout(u.id))!.reason).toBe('dann');
		expect(await auditActions()).toEqual(['timeout_set', 'timeout_lifted', 'timeout_set']);
	});

	it('does not touch earlier expired timeouts when setting a new one', async () => {
		const mod = await userWithRole('moderator');
		const u = await userWithRole();
		await insertTimeout(u.id, mod.id, new Date(Date.now() - HOUR));
		await setTimeout_(mod, u.id, 1, 'neu');
		expect(await auditActions()).toEqual(['timeout_set']);
		const [old] = await db.select().from(timeouts).orderBy(timeouts.id).limit(1);
		expect(old.liftedAt).toBeNull();
	});
});

describe('liftTimeout', () => {
	it('lifts the active timeout, records the actor and audits it', async () => {
		const mod = await userWithRole('moderator');
		const u = await userWithRole();
		await setTimeout_(mod, u.id, 5, 'Grund');
		await liftTimeout(mod, u.id);
		expect(await activeTimeout(u.id)).toBeNull();
		const [row] = await db.select().from(timeouts).where(eq(timeouts.userId, u.id));
		expect(row.liftedBy).toBe(mod.id);
		expect(row.liftedAt).toBeInstanceOf(Date);
		expect(await auditActions()).toEqual(['timeout_set', 'timeout_lifted']);
		const [entry] = (await listAudit({ action: 'timeout_lifted' })).entries;
		expect(entry).toMatchObject({ targetType: 'user', targetId: u.id, actorId: mod.id });
	});

	it('follows the same actor rules: moderators cannot lift timeouts of mods or admins, members cannot lift any', async () => {
		const admin = await userWithRole('admin');
		const mod = await userWithRole('moderator');
		const otherMod = await userWithRole('moderator');
		const member = await userWithRole();
		await setTimeout_(admin, otherMod.id, 5, 'x');
		const otherAdmin = await userWithRole('admin');
		await setTimeout_(admin, otherAdmin.id, 5, 'x');
		await expectTimeoutError(liftTimeout(mod, otherMod.id), 'forbidden');
		await expectTimeoutError(liftTimeout(mod, otherAdmin.id), 'forbidden');
		await setTimeout_(mod, member.id, 5, 'x');
		await expectTimeoutError(liftTimeout(member, otherMod.id), 'forbidden');
		await liftTimeout(mod, member.id);
		expect(await activeTimeout(member.id)).toBeNull();
		expect(await activeTimeout(otherMod.id)).not.toBeNull();
		await liftTimeout(admin, otherMod.id);
		expect(await activeTimeout(otherMod.id)).toBeNull();
	});

	it('rejects lifting when there is nothing active or the user is unknown', async () => {
		const mod = await userWithRole('moderator');
		const u = await userWithRole();
		await expectTimeoutError(liftTimeout(mod, u.id), 'notfound');
		await expectTimeoutError(liftTimeout(mod, 99999), 'notfound');
		await insertTimeout(u.id, mod.id, new Date(Date.now() - HOUR));
		await expectTimeoutError(liftTimeout(mod, u.id), 'notfound');
		expect(await auditActions()).toEqual([]);
	});
});

describe('resolveReports', () => {
	it.each(['actioned', 'removed'] as const)(
		'%s closes all open reports of that content only and leaves reviewedAt unset',
		async (outcome) => {
			const author = await userWithRole();
			const mod = await userWithRole('moderator');
			const id = await addMeme(author.id);
			const other = await addMeme(author.id);
			await reportBy(3, 'meme', id);
			await reportBy(1, 'meme', other);
			await resolveReports(mod, 'meme', id, outcome);
			const closed = await db.select().from(reports).where(eq(reports.contentId, id));
			expect(closed).toHaveLength(3);
			for (const r of closed) {
				expect(r).toMatchObject({ status: 'resolved', outcome, resolvedBy: mod.id });
				expect(r.resolvedAt).toBeInstanceOf(Date);
			}
			const [untouched] = await db.select().from(reports).where(eq(reports.contentId, other));
			expect(untouched).toMatchObject({ status: 'open', outcome: null, resolvedAt: null });
			const [m] = await db.select().from(media).where(eq(media.id, id));
			expect(m.reviewedAt).toBeNull();
			expect(await openReportCount('meme', id)).toBe(0);
			expect(await auditActions()).toEqual([]);
		}
	);

	it('dismissed closes reports, stamps reviewedAt and writes a report_dismissed audit row', async () => {
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const id = await addMeme(author.id, 'Titel');
		await reportBy(2, 'meme', id);
		await resolveReports(mod, 'meme', id, 'dismissed');
		const rows = await db.select().from(reports).where(eq(reports.contentId, id));
		expect(rows.every((r) => r.status === 'resolved' && r.outcome === 'dismissed')).toBe(true);
		const [m] = await db.select().from(media).where(eq(media.id, id));
		expect(m.reviewedAt).toBeInstanceOf(Date);
		const { entries } = await listAudit();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			action: 'report_dismissed',
			actorId: mod.id,
			targetType: 'meme',
			targetId: id
		});
		expect(entries[0].detail).toContain('Titel');
	});

	it('dismissal grants permanent immunity: fresh reports beyond the threshold stay below review', async () => {
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const id = await addMeme(author.id);
		await reportBy(env.REPORT_REVIEW_THRESHOLD + 1, 'meme', id);
		expect(await isUnderReview('meme', id)).toBe(true);
		await resolveReports(mod, 'meme', id, 'dismissed');
		expect(await isUnderReview('meme', id)).toBe(false);
		await reportBy(env.REPORT_REVIEW_THRESHOLD + 1, 'meme', id);
		expect(await openReportCount('meme', id)).toBe(env.REPORT_REVIEW_THRESHOLD + 1);
		expect(await isUnderReview('meme', id)).toBe(false);
	});

	it('dismissed stamps reviewedAt on comments and quotes too', async () => {
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const memeId = await addMeme(author.id);
		const commentId = await addComment(author.id, memeId, 'hallo');
		const quoteId = await addQuote(author.id, 'zitat');
		await reportBy(1, 'comment', commentId);
		await reportBy(1, 'quote', quoteId);
		await resolveReports(mod, 'comment', commentId, 'dismissed');
		await resolveReports(mod, 'quote', quoteId, 'dismissed');
		const [c] = await db.select().from(comments).where(eq(comments.id, commentId));
		const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
		expect(c.reviewedAt).toBeInstanceOf(Date);
		expect(q.reviewedAt).toBeInstanceOf(Date);
		const [m] = await db.select().from(media).where(eq(media.id, memeId));
		expect(m.reviewedAt).toBeNull();
	});

	it('does not close already resolved reports again', async () => {
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const admin = await userWithRole('admin');
		const id = await addMeme(author.id);
		await reportBy(1, 'meme', id);
		await resolveReports(mod, 'meme', id, 'actioned');
		await resolveReports(admin, 'meme', id, 'removed');
		const [r] = await db
			.select()
			.from(reports)
			.where(and(eq(reports.contentType, 'meme'), eq(reports.contentId, id)));
		expect(r).toMatchObject({ outcome: 'actioned', resolvedBy: mod.id });
	});

	it('survives content that no longer exists (reports outlive their content)', async () => {
		const author = await userWithRole();
		const mod = await userWithRole('moderator');
		const id = await addMeme(author.id);
		await reportBy(1, 'meme', id);
		await db.delete(media).where(eq(media.id, id));
		await resolveReports(mod, 'meme', id, 'removed');
		const [r] = await db.select().from(reports);
		expect(r).toMatchObject({ status: 'resolved', outcome: 'removed' });
	});
});

describe('audit / listAudit', () => {
	it('lists newest first, filters by action and paginates with a cursor', async () => {
		const mod = await userWithRole('moderator');
		for (let i = 1; i <= 60; i++) {
			await audit(mod.id, i % 2 === 0 ? 'content_deleted' : 'flags_forced', 'meme', i, `d${i}`);
		}
		const page1 = await listAudit();
		expect(page1.entries).toHaveLength(50);
		expect(page1.entries[0].targetId).toBe(60);
		expect(page1.entries[0]).toMatchObject({ actorName: mod.username, detail: 'd60' });
		expect(page1.nextCursor).not.toBeNull();
		const page2 = await listAudit({}, page1.nextCursor!);
		expect(page2.entries.map((e) => e.targetId)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
		expect(page2.nextCursor).toBeNull();

		const deleted = await listAudit({ action: 'content_deleted' });
		expect(deleted.entries).toHaveLength(30);
		expect(deleted.entries.every((e) => e.action === 'content_deleted')).toBe(true);
		expect(deleted.nextCursor).toBeNull();
	});

	it('defaults detail to an empty string', async () => {
		const mod = await userWithRole('moderator');
		await audit(mod.id, 'flags_forced', 'meme', 1);
		expect((await listAudit()).entries[0].detail).toBe('');
	});
});
