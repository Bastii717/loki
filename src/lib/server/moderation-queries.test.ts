import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { comments, media, quotes, reports, timeouts } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { createReport, resolveReports, setTimeout_ } from './moderation';
import {
	countOpenCases,
	DONE_PAGE_SIZE,
	getOpenCase,
	listActiveTimeouts,
	listDoneCases,
	listOpenCases,
	listUserOverview,
	QUEUE_PAGE_SIZE,
	searchUsers,
	namesById
} from './moderation-queries';
import { addOpenReports, OVER_THRESHOLD } from './moderation-test-utils';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const asSession = (u: { id: number; username: string; role: string }) =>
	({ id: u.id, username: u.username, displayName: null, role: u.role }) as SessionUser;

async function meme(uploaderId: number, title = 'Titel') {
	const [row] = await db
		.insert(media)
		.values({
			uploaderId,
			title,
			kind: 'gif',
			objectKey: 'memes/o.webp',
			thumbKey: 'memes/t.webp'
		})
		.returning({ id: media.id });
	return row.id;
}

async function comment(authorId: number, mediaId: number, text = 'Kommentartext') {
	const [row] = await db
		.insert(comments)
		.values({ authorId, mediaId, text })
		.returning({ id: comments.id });
	return row.id;
}

async function quote(submittedBy: number, text = 'Zitattext') {
	const [row] = await db
		.insert(quotes)
		.values({ submittedBy, text, author: 'Opa' })
		.returning({ id: quotes.id });
	return row.id;
}

describe('listOpenCases', () => {
	it('groups open reports per content with categories, reporters, age and preview', async () => {
		const author = await testUser();
		const [r1, r2, r3] = [await testUser(), await testUser(), await testUser()];
		const memeId = await meme(author.id, 'Mein Meme');
		await createReport(asSession(r1), 'meme', memeId, 'spam', 'schon wieder');
		await createReport(asSession(r2), 'meme', memeId, 'spam');
		await createReport(asSession(r3), 'meme', memeId, 'hurtful', 'gemein');

		const { cases, nextCursor } = await listOpenCases();
		expect(nextCursor).toBeNull();
		expect(cases).toHaveLength(1);
		const c = cases[0];
		expect(c).toMatchObject({
			contentType: 'meme',
			contentId: memeId,
			authorId: author.id,
			author: author.username,
			authorRole: 'member',
			excerpt: 'Mein Meme',
			underReview: false,
			preview: { type: 'meme', title: 'Mein Meme', kind: 'gif', thumbUrl: '/media/memes/t.webp' }
		});
		expect(c.categories).toEqual([
			{ category: 'spam', count: 2 },
			{ category: 'hurtful', count: 1 }
		]);
		expect(c.reports.map((r) => [r.reporter, r.category, r.text])).toEqual([
			[r1.username, 'spam', 'schon wieder'],
			[r2.username, 'spam', ''],
			[r3.username, 'hurtful', 'gemein']
		]);
		expect(new Date(c.oldest).getTime()).toBeLessThanOrEqual(Date.now());
	});

	it('exposes display forms next to usernames for author and reporters', async () => {
		const author = await testUser({
			username: 'auth',
			displayName: 'Autorin',
			displayNameKey: 'autorin'
		});
		const named = await testUser({
			username: 'rep1',
			displayName: 'Melder',
			displayNameKey: 'melder'
		});
		const plain = await testUser({ username: 'rep2' });
		const memeId = await meme(author.id);
		await createReport(asSession(named), 'meme', memeId, 'spam');
		await createReport(asSession(plain), 'meme', memeId, 'spam');

		const [open] = (await listOpenCases()).cases;
		expect(open).toMatchObject({ author: 'auth', authorDisplay: 'Autorin' });
		expect(open.reports.map((r) => [r.reporter, r.reporterDisplay])).toEqual([
			['rep1', 'Melder'],
			['rep2', 'rep2']
		]);

		await resolveReports(
			asSession(await testUser({ role: 'moderator' })),
			'meme',
			memeId,
			'dismissed'
		);
		const [done] = (await listDoneCases()).cases;
		expect(done).toMatchObject({ author: 'auth', authorDisplay: 'Autorin' });
		expect(done.reports.map((r) => r.reporterDisplay)).toEqual(['Melder', 'rep2']);
	});

	it('shows comments and quotes with their text, and flags over-threshold ones as under review', async () => {
		const author = await testUser();
		const memeId = await meme(author.id);
		const commentId = await comment(author.id, memeId);
		const quoteId = await quote(author.id);
		await addOpenReports('comment', commentId, author.id, OVER_THRESHOLD);
		await addOpenReports('quote', quoteId, author.id, 1);

		const { cases } = await listOpenCases();
		const byType = Object.fromEntries(cases.map((c) => [c.contentType, c]));
		expect(byType.comment.preview).toEqual({
			type: 'comment',
			text: 'Kommentartext',
			mediaId: memeId
		});
		expect(byType.comment.underReview).toBe(true);
		expect(byType.quote.preview).toEqual({ type: 'quote', text: 'Zitattext', author: 'Opa' });
		expect(byType.quote.underReview).toBe(false);
	});

	it('keeps a case whose content is gone, without preview, using the snapshot excerpt', async () => {
		const author = await testUser();
		const memeId = await meme(author.id, 'Weg');
		await addOpenReports('meme', memeId, author.id, 1);
		await db.update(reports).set({ excerpt: 'Weg' });
		await db.delete(media).where(eq(media.id, memeId));
		const { cases } = await listOpenCases();
		expect(cases).toHaveLength(1);
		expect(cases[0]).toMatchObject({ preview: null, excerpt: 'Weg', underReview: false });
	});

	it('ignores resolved reports, orders oldest case first and paginates by cursor', async () => {
		const author = await testUser();
		const ids: number[] = [];
		for (let i = 0; i < QUEUE_PAGE_SIZE + 2; i++) {
			const id = await meme(author.id, `m${i}`);
			ids.push(id);
			await addOpenReports('meme', id, author.id, 1);
		}
		const actor = asSession(await testUser({ role: 'moderator' }));
		await resolveReports(actor, 'meme', ids[0], 'actioned');

		const first = await listOpenCases();
		expect(first.cases.map((c) => c.contentId)).toEqual(ids.slice(1, QUEUE_PAGE_SIZE + 1));
		expect(first.nextCursor).not.toBeNull();
		const second = await listOpenCases(first.nextCursor!);
		expect(second.cases.map((c) => c.contentId)).toEqual([ids[QUEUE_PAGE_SIZE + 1]]);
		expect(second.nextCursor).toBeNull();
	});

	it('countOpenCases counts contents, not reports', async () => {
		const author = await testUser();
		expect(await countOpenCases()).toBe(0);
		const a = await meme(author.id);
		const b = await meme(author.id);
		await addOpenReports('meme', a, author.id, 3);
		await addOpenReports('meme', b, author.id, 1);
		expect(await countOpenCases()).toBe(2);
		await resolveReports(asSession(await testUser({ role: 'moderator' })), 'meme', a, 'dismissed');
		expect(await countOpenCases()).toBe(1);
	});

	it('getOpenCase finds the author and excerpt, null once resolved', async () => {
		const author = await testUser();
		const id = await meme(author.id, 'T');
		expect(await getOpenCase('meme', id)).toBeNull();
		await addOpenReports('meme', id, author.id, 1);
		expect(await getOpenCase('meme', id)).toMatchObject({ authorId: author.id });
		await resolveReports(asSession(await testUser({ role: 'moderator' })), 'meme', id, 'removed');
		expect(await getOpenCase('meme', id)).toBeNull();
	});
});

describe('listDoneCases', () => {
	it('lists resolved decisions newest first with outcome and resolver, one entry per decision', async () => {
		const author = await testUser();
		const mod = asSession(await testUser({ role: 'moderator' }));
		const a = await meme(author.id, 'A');
		const b = await meme(author.id, 'B');
		await addOpenReports('meme', a, author.id, 2);
		await addOpenReports('meme', b, author.id, 1);
		await resolveReports(mod, 'meme', a, 'dismissed');
		await resolveReports(mod, 'meme', b, 'actioned');
		// a re-reported and resolved a second time: a second decision on the same content
		await addOpenReports('meme', a, author.id, 1);
		await resolveReports(mod, 'meme', a, 'removed');

		const { cases, nextCursor } = await listDoneCases();
		expect(nextCursor).toBeNull();
		expect(cases.map((c) => [c.contentId, c.outcome, c.reports.length])).toEqual([
			[a, 'removed', 1],
			[b, 'actioned', 1],
			[a, 'dismissed', 2]
		]);
		expect(cases[0]).toMatchObject({ resolvedBy: mod.username, author: author.username });
	});

	it('paginates with an opaque cursor and survives a garbage cursor', async () => {
		const author = await testUser();
		const mod = asSession(await testUser({ role: 'moderator' }));
		const ids: number[] = [];
		for (let i = 0; i < DONE_PAGE_SIZE + 1; i++) {
			const id = await meme(author.id);
			ids.push(id);
			await addOpenReports('meme', id, author.id, 1);
			await resolveReports(mod, 'meme', id, 'actioned');
		}
		const first = await listDoneCases();
		expect(first.cases).toHaveLength(DONE_PAGE_SIZE);
		expect(first.cases[0].contentId).toBe(ids[ids.length - 1]);
		const second = await listDoneCases(first.nextCursor!);
		expect(second.cases.map((c) => c.contentId)).toEqual([ids[0]]);
		expect(second.nextCursor).toBeNull();
		expect((await listDoneCases('???')).cases).toHaveLength(DONE_PAGE_SIZE);
	});
});

describe('listActiveTimeouts', () => {
	it('lists only timeouts in force with user, setter and reason', async () => {
		const admin = asSession(await testUser({ role: 'admin' }));
		const a = await testUser();
		const b = await testUser();
		const c = await testUser();
		await setTimeout_(admin, a.id, 3, 'Streit');
		await setTimeout_(admin, b.id, 1, 'Spam');
		await setTimeout_(admin, c.id, 2, 'war mal');
		await db.update(timeouts).set({ liftedAt: new Date() }).where(eq(timeouts.userId, c.id));
		await db
			.update(timeouts)
			.set({ until: new Date(Date.now() - 1000) })
			.where(eq(timeouts.userId, b.id));

		const list = await listActiveTimeouts();
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			userId: a.id,
			username: a.username,
			role: 'member',
			reason: 'Streit',
			setBy: admin.username
		});
	});
});

describe('listUserOverview', () => {
	it('reports role, counts, confirmed reports, active and past timeouts per user', async () => {
		const admin = asSession(await testUser({ role: 'admin' }));
		const bad = await testUser();
		const clean = await testUser();
		const m1 = await meme(bad.id);
		const m2 = await meme(bad.id);
		await comment(bad.id, m1);
		await quote(bad.id);
		await quote(bad.id);
		await quote(clean.id);

		// two confirmed reports on one content, one dismissed on another, one removed
		await addOpenReports('meme', m1, bad.id, 2);
		await resolveReports(admin, 'meme', m1, 'actioned');
		await addOpenReports('meme', m2, bad.id, 1);
		await resolveReports(admin, 'meme', m2, 'dismissed');
		await addOpenReports('meme', m2, bad.id, 1);
		await resolveReports(admin, 'meme', m2, 'removed');

		await setTimeout_(admin, bad.id, 2, 'erster');
		await setTimeout_(admin, bad.id, 5, 'zweiter'); // replaces the first
		await setTimeout_(admin, clean.id, 1, 'x');
		await db.update(timeouts).set({ liftedAt: new Date() }).where(eq(timeouts.userId, clean.id));

		const overview = await listUserOverview();
		const byName = Object.fromEntries(overview.map((u) => [u.username, u]));
		expect(byName[bad.username]).toMatchObject({
			role: 'member',
			memes: 2,
			comments: 1,
			quotes: 2,
			confirmedReports: 2,
			confirmedCases: 1
		});
		expect(byName[bad.username].activeTimeout).toMatchObject({
			reason: 'zweiter',
			setBy: admin.username
		});
		expect(byName[bad.username].pastTimeouts.map((t) => t.reason)).toEqual(['erster']);
		expect(byName[clean.username]).toMatchObject({
			memes: 0,
			quotes: 1,
			confirmedReports: 0,
			activeTimeout: null
		});
		expect(byName[clean.username].pastTimeouts).toHaveLength(1);
		expect(byName[admin.username].role).toBe('admin');
		// most confirmed reports first
		expect(overview[0].username).toBe(bad.username);
	});
});

describe('listUserOverview profile fields', () => {
	it('returns display name, avatar thumb key and motto, null/empty when unset', async () => {
		const named = await testUser({
			displayName: 'Ronja',
			displayNameKey: 'ronja',
			avatarThumbKey: 'avatars/b-thumb.webp',
			motto: 'Ship it'
		});
		const plain = await testUser();
		const overview = await listUserOverview();
		expect(overview.find((u) => u.id === named.id)).toMatchObject({
			displayName: 'Ronja',
			avatarThumbKey: 'avatars/b-thumb.webp',
			motto: 'Ship it'
		});
		expect(overview.find((u) => u.id === plain.id)).toMatchObject({
			displayName: null,
			avatarThumbKey: null,
			motto: ''
		});
	});
});

describe('listUserOverview confirmed counts', () => {
	it("excludes 'removed' and 'dismissed' reports from the confirmed count", async () => {
		const admin = asSession(await testUser({ role: 'admin' }));
		const author = await testUser();
		const m1 = await meme(author.id);
		const m2 = await meme(author.id);
		const m3 = await meme(author.id);
		// self-removed (the author deleted it before a moderator decided): no judgment on the author
		await addOpenReports('meme', m1, author.id, 3);
		await resolveReports(admin, 'meme', m1, 'removed');
		await addOpenReports('meme', m2, author.id, 2);
		await resolveReports(admin, 'meme', m2, 'dismissed');
		const before = (await listUserOverview()).find((u) => u.username === author.username)!;
		expect(before).toMatchObject({ confirmedReports: 0, confirmedCases: 0 });

		// only the 'actioned' one counts, next to the removed ones
		await addOpenReports('meme', m3, author.id, 1);
		await resolveReports(admin, 'meme', m3, 'actioned');
		const after = (await listUserOverview()).find((u) => u.username === author.username)!;
		expect(after).toMatchObject({ confirmedReports: 1, confirmedCases: 1 });
	});
});

describe('searchUsers / namesById', () => {
	it('matches usernames case-insensitively as a substring and escapes wildcards', async () => {
		await testUser({ username: 'Anna_Banane' });
		await testUser({ username: 'annabelle' });
		await testUser({ username: 'Bob' });
		expect((await searchUsers('ANNA')).map((u) => u.username).sort()).toEqual([
			'Anna_Banane',
			'annabelle'
		]);
		expect((await searchUsers('a_b')).map((u) => u.username)).toEqual(['Anna_Banane']);
		expect(await searchUsers('%')).toEqual([]);
		expect(await searchUsers('')).toHaveLength(3);
		expect(await searchUsers('', 2)).toHaveLength(2);
	});

	it('resolves ids to display name, username and role', async () => {
		const u = await testUser({ username: 'Zed' });
		const named = await testUser({
			username: 'yan',
			displayName: 'Yannick',
			displayNameKey: 'yannick',
			role: 'moderator'
		});
		const map = await namesById([u.id, u.id, named.id, 99999]);
		expect(map.get(u.id)).toEqual({
			display: 'Zed',
			username: 'Zed',
			role: 'member'
		});
		expect(map.get(named.id)).toEqual({
			display: 'Yannick',
			username: 'yan',
			role: 'moderator'
		});
		expect(map.has(99999)).toBe(false);
		expect((await namesById([])).size).toBe(0);
	});
});
