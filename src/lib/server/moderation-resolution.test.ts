import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteComment } from './comments';
import { db } from './db';
import { auditLog, comments, media, quotes, reports } from './db/schema';
import { resetDb, setupDb } from './db/test-utils';
import { deleteMedia, setFlags } from './memes';
import {
	addOpenReports,
	insertComment,
	insertMeme,
	insertQuote,
	timeOut,
	userWithSession
} from './moderation-test-utils';
import { actOnCase, CaseError } from './moderation-cases';
import { resolveReports } from './moderation';
import { deleteQuote } from './quotes';
import { ensureBucket } from './storage-test-utils';

beforeAll(async () => {
	await setupDb();
	await ensureBucket(); // deleting a meme removes its bucket objects
});
beforeEach(resetDb);

type ContentType = 'meme' | 'comment' | 'quote';

const user = async (role: 'member' | 'moderator' | 'admin') => (await userWithSession(role)).user;

/** Inserts a reported item of `type` authored by `authorId` and returns a deleter bound to a user. */
async function reportedItem(type: ContentType, authorId: number) {
	const memeId = await insertMeme(authorId, 'Titel');
	const id =
		type === 'meme'
			? memeId
			: type === 'comment'
				? await insertComment(authorId, memeId, 'Kommentar')
				: await insertQuote(authorId, 'Zitat');
	await addOpenReports(type, id, authorId, 2);
	return id;
}

const remove = (type: ContentType, actor: Awaited<ReturnType<typeof user>>, id: number) =>
	type === 'meme'
		? deleteMedia(actor, id)
		: type === 'comment'
			? deleteComment(actor, id)
			: deleteQuote(actor, id);

const reportRows = (type: ContentType, id: number) =>
	db
		.select()
		.from(reports)
		.where(and(eq(reports.contentType, type), eq(reports.contentId, id)));

const audits = () => db.select().from(auditLog);

describe('deleting content closes its open reports', () => {
	// quotes: only moderators delete, so the "own" case is a moderator removing their own quote
	it.each(['meme', 'comment', 'quote'] as const)(
		'%s: the author deleting their own content closes the reports as removed, without an audit row',
		async (type) => {
			const author = await user(type === 'quote' ? 'moderator' : 'member');
			const id = await reportedItem(type, author.id);
			await remove(type, author, id);
			const rows = await reportRows(type, id);
			expect(rows).toHaveLength(2);
			for (const r of rows) {
				expect(r).toMatchObject({ status: 'resolved', outcome: 'removed', resolvedBy: author.id });
			}
			expect(await audits()).toHaveLength(0);
		}
	);

	it.each(['meme', 'comment', 'quote'] as const)(
		'%s: a moderator deleting foreign content inline closes the case as actioned and audits content_deleted',
		async (type) => {
			const author = await user('member');
			const mod = await user('moderator');
			const id = await reportedItem(type, author.id);
			await remove(type, mod, id);
			const rows = await reportRows(type, id);
			expect(rows.every((r) => r.status === 'resolved' && r.outcome === 'actioned')).toBe(true);
			const log = await audits();
			expect(log).toHaveLength(1);
			expect(log[0]).toMatchObject({
				action: 'content_deleted',
				actorId: mod.id,
				targetType: type,
				targetId: id
			});
			expect(log[0].detail).toContain(author.username);
			expect(log[0].detail).toContain('x'); // the excerpt of the report
		}
	);

	it.each(['meme', 'comment', 'quote'] as const)(
		'%s: deleting an unreported item writes no audit row and touches no reports',
		async (type) => {
			const author = await user('member');
			const mod = await user('moderator');
			const memeId = await insertMeme(author.id);
			const id =
				type === 'meme'
					? memeId
					: type === 'comment'
						? await insertComment(author.id, memeId)
						: await insertQuote(author.id);
			await remove(type, mod, id);
			expect(await audits()).toHaveLength(0);
			expect(await reportRows(type, id)).toHaveLength(0);
		}
	);

	it('a timed-out moderator is refused and the case stays open', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('meme', author.id);
		await timeOut(mod.id, mod.id);
		await expect(deleteMedia(mod, id)).rejects.toThrow();
		expect((await reportRows('meme', id)).every((r) => r.status === 'open')).toBe(true);
		expect(await audits()).toHaveLength(0);
	});

	it('tolerates bucket objects that are already gone', async () => {
		const author = await user('member');
		const id = await insertMeme(author.id); // its fake object keys never existed in the bucket
		await deleteMedia(author, id);
		expect(await db.select().from(media).where(eq(media.id, id))).toHaveLength(0);
	});
});

describe('forced flags on foreign memes', () => {
	it('closes the case as actioned and audits flags_forced', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('meme', author.id);
		await setFlags(mod, id, { nsfw: true });
		expect((await reportRows('meme', id)).every((r) => r.outcome === 'actioned')).toBe(true);
		const log = await audits();
		expect(log).toHaveLength(1);
		expect(log[0]).toMatchObject({ action: 'flags_forced', actorId: mod.id, targetId: id });
		expect(log[0].detail).toContain('NSFW erzwungen');
		const [row] = await db.select().from(media).where(eq(media.id, id));
		expect(row).toMatchObject({ nsfw: true, reviewedAt: null });
	});

	it('names every forced flag', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('meme', author.id);
		await setFlags(mod, id, { nsfw: true, spoiler: true });
		expect((await audits())[0].detail).toContain('NSFW und Spoiler erzwungen');
	});

	it('does not resolve when a moderator switches a flag off, or when the uploader sets their own', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('meme', author.id);
		await setFlags(mod, id, { nsfw: false });
		await setFlags(author, id, { nsfw: true });
		expect((await reportRows('meme', id)).every((r) => r.status === 'open')).toBe(true);
		expect(await audits()).toHaveLength(0);
	});

	it("a moderator's flags on their own meme do not resolve their own case", async () => {
		const mod = await user('moderator');
		const id = await reportedItem('meme', mod.id);
		await setFlags(mod, id, { nsfw: true });
		expect((await reportRows('meme', id)).every((r) => r.status === 'open')).toBe(true);
	});
});

describe('resolveReports return value', () => {
	it('returns the number of closed reports, 0 when nothing was open', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('comment', author.id);
		expect(await resolveReports(mod, 'comment', id, 'actioned')).toBe(2);
		expect(await resolveReports(mod, 'comment', id, 'actioned')).toBe(0);
	});

	it('dismissing with nothing open writes no audit row and stamps no immunity', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('comment', author.id);
		await resolveReports(mod, 'comment', id, 'actioned');
		expect(await resolveReports(mod, 'comment', id, 'dismissed')).toBe(0);
		expect(await audits()).toHaveLength(0);
		const [row] = await db.select().from(comments).where(eq(comments.id, id));
		expect(row.reviewedAt).toBeNull();
	});
});

describe('actOnCase edge cases', () => {
	it('ghost case: delete on content that is already gone still closes the case and audits it', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('quote', author.id);
		await db.delete(quotes).where(eq(quotes.id, id));
		await actOnCase(mod, 'quote', id, { type: 'delete' });
		const rows = await reportRows('quote', id);
		expect(rows.every((r) => r.status === 'resolved' && r.outcome === 'actioned')).toBe(true);
		const log = await audits();
		expect(log).toHaveLength(1);
		expect(log[0]).toMatchObject({ action: 'content_deleted', targetType: 'quote', targetId: id });
	});

	it("ghost case on the actor's own content closes it as removed without an audit row", async () => {
		const mod = await user('moderator');
		const id = await reportedItem('comment', mod.id);
		await db.delete(comments).where(eq(comments.id, id));
		await actOnCase(mod, 'comment', id, { type: 'delete' });
		expect((await reportRows('comment', id)).every((r) => r.outcome === 'removed')).toBe(true);
		expect(await audits()).toHaveLength(0);
	});

	it('queue delete audits exactly once (the module and the queue do not both write)', async () => {
		const author = await user('member');
		const mod = await user('moderator');
		const id = await reportedItem('meme', author.id);
		await actOnCase(mod, 'meme', id, { type: 'delete' });
		expect(await audits()).toHaveLength(1);
	});

	it('two concurrent releases: one wins, the other gets notfound, exactly one report_dismissed row', async () => {
		const author = await user('member');
		const modA = await user('moderator');
		const modB = await user('moderator');
		const id = await reportedItem('comment', author.id);
		const results = await Promise.allSettled([
			actOnCase(modA, 'comment', id, { type: 'release' }),
			actOnCase(modB, 'comment', id, { type: 'release' })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(lost.reason).toBeInstanceOf(CaseError);
		expect(lost.reason.code).toBe('notfound');
		const log = await audits();
		expect(log).toHaveLength(1);
		expect(log[0].action).toBe('report_dismissed');
	});
});
