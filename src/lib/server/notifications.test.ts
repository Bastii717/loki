import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { media, notificationPrefs, notifications, users } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { insertComment, insertMeme, insertQuote } from './moderation-test-utils';
import {
	commentExcerpt,
	countUnread,
	EXCERPT_LENGTH,
	getPrefs,
	listNotifications,
	markAllRead,
	notify,
	NOTIFICATION_KINDS,
	openNotification,
	setPrefs,
	sweepNotifications,
	type NotifyInput
} from './notifications';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const DAY = 86_400_000;

async function rows() {
	return db.select().from(notifications).orderBy(notifications.id);
}

/** Inserts a notice directly, with a controllable `updatedAt`. Returns its id. */
async function seed(
	userId: number,
	overrides: Partial<typeof notifications.$inferInsert> = {}
): Promise<number> {
	const [row] = await db
		.insert(notifications)
		.values({ userId, kind: 'comment', ...overrides })
		.returning({ id: notifications.id });
	return row.id;
}

const at = (iso: string) => new Date(iso);

describe('commentExcerpt', () => {
	it('collapses whitespace and line breaks, and trims', () => {
		expect(commentExcerpt('  one\n\ntwo \r\n three  ')).toBe('one two three');
	});

	it('cuts at 80 characters', () => {
		expect(EXCERPT_LENGTH).toBe(80);
		expect(commentExcerpt('a'.repeat(100))).toBe('a'.repeat(80));
	});

	it('trims after cutting', () => {
		expect(commentExcerpt(`${'a'.repeat(79)} bbb`)).toBe('a'.repeat(79));
	});

	it('does not split a surrogate pair', () => {
		expect(commentExcerpt('😀'.repeat(100))).toBe('😀'.repeat(80));
	});
});

describe('notify', () => {
	it('lists the twelve kinds', () => {
		expect(NOTIFICATION_KINDS).toEqual([
			'comment',
			'thread_comment',
			'content_deleted',
			'content_flagged',
			'content_released',
			'report_resolved',
			'timeout_set',
			'timeout_lifted',
			'name_changed',
			'name_reset',
			'avatar_removed',
			'motto_cleared'
		]);
	});

	it('inserts a notice with the given fields', async () => {
		const user = await testUser();
		const actor = await testUser();
		const mediaId = await insertMeme(user.id);
		await notify(db, {
			userId: user.id,
			kind: 'comment',
			actorId: actor.id,
			contentType: 'comment',
			contentId: 7,
			mediaId,
			detail: 'Hello'
		});
		const [row] = await rows();
		expect(row).toMatchObject({
			userId: user.id,
			kind: 'comment',
			actorId: actor.id,
			contentType: 'comment',
			contentId: 7,
			mediaId,
			detail: 'Hello',
			count: 1,
			readAt: null
		});
	});

	it('defaults the optional fields to null and an empty detail', async () => {
		const user = await testUser();
		await notify(db, { userId: user.id, kind: 'timeout_lifted' });
		const [row] = await rows();
		expect(row).toMatchObject({
			actorId: null,
			contentType: null,
			contentId: null,
			mediaId: null,
			detail: ''
		});
	});

	it('never notifies the actor about their own action', async () => {
		const user = await testUser();
		for (const kind of NOTIFICATION_KINDS) {
			await notify(db, { userId: user.id, kind, actorId: user.id });
		}
		expect(await rows()).toHaveLength(0);
	});

	it('skips comment, thread_comment and report_resolved when the pref is off, but not content_deleted', async () => {
		const user = await testUser();
		const actor = await testUser();
		await setPrefs(user.id, { comments: false, threadComments: false, reportOutcomes: false });
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id });
		await notify(db, { userId: user.id, kind: 'thread_comment', actorId: actor.id });
		await notify(db, { userId: user.id, kind: 'report_resolved', detail: 'dismissed:x' });
		expect(await rows()).toHaveLength(0);
		await notify(db, { userId: user.id, kind: 'content_deleted', contentType: 'meme' });
		expect(await rows()).toHaveLength(1);
	});

	it('only the matching pref switches a kind off', async () => {
		const user = await testUser();
		const actor = await testUser();
		await setPrefs(user.id, { comments: false, threadComments: true, reportOutcomes: true });
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id });
		await notify(db, { userId: user.id, kind: 'thread_comment', actorId: actor.id });
		await notify(db, { userId: user.id, kind: 'report_resolved', detail: 'dismissed:x' });
		expect((await rows()).map((r) => r.kind)).toEqual(['thread_comment', 'report_resolved']);
	});

	it('coalesces an unread comment into one row', async () => {
		const user = await testUser();
		const first = await testUser();
		const second = await testUser();
		const mediaId = await insertMeme(user.id);
		const input = (actorId: number, detail: string): NotifyInput => ({
			userId: user.id,
			kind: 'comment',
			actorId,
			contentType: 'comment',
			mediaId,
			detail
		});
		await notify(db, input(first.id, 'one'));
		const [before] = await rows();
		await notify(db, input(second.id, 'two'));
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ id: before.id, count: 2, actorId: second.id, detail: 'two' });
		expect(all[0].updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
		expect(all[0].createdAt).toEqual(before.createdAt);
	});

	it('coalesces thread_comment too', async () => {
		const user = await testUser();
		const actor = await testUser();
		const mediaId = await insertMeme(user.id);
		for (let i = 0; i < 3; i++) {
			await notify(db, { userId: user.id, kind: 'thread_comment', actorId: actor.id, mediaId });
		}
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].count).toBe(3);
	});

	it('does not coalesce across kinds, recipients or memes', async () => {
		const user = await testUser();
		const other = await testUser();
		const actor = await testUser();
		const m1 = await insertMeme(user.id);
		const m2 = await insertMeme(user.id);
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId: m1 });
		await notify(db, { userId: user.id, kind: 'thread_comment', actorId: actor.id, mediaId: m1 });
		await notify(db, { userId: other.id, kind: 'comment', actorId: actor.id, mediaId: m1 });
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId: m2 });
		expect(await rows()).toHaveLength(4);
	});

	it('does not reuse a read row', async () => {
		const user = await testUser();
		const actor = await testUser();
		const mediaId = await insertMeme(user.id);
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId });
		await markAllRead(user.id);
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId });
		const all = await rows();
		expect(all).toHaveLength(2);
		expect(all.map((r) => r.count)).toEqual([1, 1]);
		expect(all[0].readAt).not.toBeNull();
		expect(all[1].readAt).toBeNull();
	});

	it('does not bump the old row once the pref is off', async () => {
		const user = await testUser();
		const actor = await testUser();
		const mediaId = await insertMeme(user.id);
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId, detail: 'a' });
		await setPrefs(user.id, { comments: false, threadComments: true, reportOutcomes: true });
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId, detail: 'b' });
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ count: 1, detail: 'a' });
	});

	it('never coalesces moderation kinds', async () => {
		const user = await testUser();
		await notify(db, {
			userId: user.id,
			kind: 'content_deleted',
			contentType: 'comment',
			contentId: 1
		});
		await notify(db, {
			userId: user.id,
			kind: 'content_deleted',
			contentType: 'comment',
			contentId: 1
		});
		const all = await rows();
		expect(all).toHaveLength(2);
		expect(all.map((r) => r.count)).toEqual([1, 1]);
	});

	it('runs inside the caller transaction: a rollback leaves nothing', async () => {
		const user = await testUser();
		await expect(
			db.transaction(async (tx) => {
				await notify(tx, { userId: user.id, kind: 'timeout_lifted' });
				throw new Error('rollback');
			})
		).rejects.toThrow('rollback');
		expect(await rows()).toHaveLength(0);
	});

	it('serializes concurrent commenters into one row', async () => {
		const user = await testUser();
		const actor = await testUser();
		const mediaId = await insertMeme(user.id);
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId });
		await Promise.all(
			Array.from({ length: 5 }, () =>
				db.transaction((tx) =>
					notify(tx, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId })
				)
			)
		);
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].count).toBe(6);
	});
});

describe('countUnread', () => {
	it('counts only the user own unread rows', async () => {
		const user = await testUser();
		const other = await testUser();
		await seed(user.id);
		await seed(user.id);
		await seed(user.id, { readAt: new Date() });
		await seed(other.id);
		expect(await countUnread(user.id)).toBe(2);
		expect(await countUnread(other.id)).toBe(1);
	});

	it('is zero without notices', async () => {
		const user = await testUser();
		expect(await countUnread(user.id)).toBe(0);
	});
});

describe('listNotifications', () => {
	it('orders by updatedAt desc, then id desc', async () => {
		const user = await testUser();
		const a = await seed(user.id, { updatedAt: at('2026-10-01T10:00:00Z') });
		const b = await seed(user.id, { updatedAt: at('2026-10-03T10:00:00Z') });
		const c = await seed(user.id, { updatedAt: at('2026-10-03T10:00:00Z') });
		const d = await seed(user.id, { updatedAt: at('2026-10-02T10:00:00Z') });
		const { items, hasMore } = await listNotifications(user.id, {});
		expect(items.map((i) => i.id)).toEqual([c, b, d, a]);
		expect(hasMore).toBe(false);
	});

	it("never lists another user's notices", async () => {
		const user = await testUser();
		const other = await testUser();
		await seed(other.id);
		expect((await listNotifications(user.id, {})).items).toHaveLength(0);
	});

	it('filters by category', async () => {
		const user = await testUser();
		const c = await seed(user.id, { kind: 'comment' });
		const t = await seed(user.id, { kind: 'thread_comment' });
		const m = await seed(user.id, { kind: 'content_deleted' });
		const r = await seed(user.id, { kind: 'report_resolved' });
		const ids = async (filter?: 'activity' | 'moderation') =>
			(await listNotifications(user.id, { filter })).items.map((i) => i.id);
		expect(await ids('activity')).toEqual([t, c]);
		expect(await ids('moderation')).toEqual([r, m]);
		expect(await ids()).toEqual([r, m, t, c]);
	});

	it('maps the fields, with the actor name, avatar and meme title', async () => {
		const user = await testUser();
		const actor = await testUser({ username: 'lena', avatarThumbKey: 'avatars/lena-t.webp' });
		const mediaId = await insertMeme(user.id, 'Cat');
		const id = await seed(user.id, {
			kind: 'comment',
			actorId: actor.id,
			contentType: 'comment',
			contentId: 3,
			mediaId,
			detail: 'Hi',
			count: 2,
			updatedAt: at('2026-10-05T08:00:00Z')
		});
		const { items } = await listNotifications(user.id, {});
		expect(items).toEqual([
			{
				id,
				kind: 'comment',
				actor: { name: 'lena', avatarThumbKey: 'avatars/lena-t.webp' },
				contentType: 'comment',
				mediaId,
				title: 'Cat',
				detail: 'Hi',
				count: 2,
				read: false,
				updatedAt: '2026-10-05T08:00:00.000Z'
			}
		]);
	});

	it('names the actor by display name when there is one', async () => {
		const user = await testUser();
		const actor = await testUser({ username: 'lena', displayName: 'Lena L.' });
		await seed(user.id, { actorId: actor.id });
		expect((await listNotifications(user.id, {})).items[0].actor?.name).toBe('Lena L.');
	});

	it('has no actor and no title for a moderation notice without a meme', async () => {
		const user = await testUser();
		await seed(user.id, { kind: 'content_deleted', readAt: new Date() });
		const [item] = (await listNotifications(user.id, {})).items;
		expect(item).toMatchObject({ actor: null, title: null, mediaId: null, read: true });
	});

	it('reports hasMore with limit 2', async () => {
		const user = await testUser();
		const ids: number[] = [];
		for (let i = 1; i <= 5; i++) {
			ids.push(await seed(user.id, { updatedAt: at(`2026-10-0${i}T10:00:00Z`) }));
		}
		const page1 = await listNotifications(user.id, { limit: 2 });
		expect(page1.items.map((i) => i.id)).toEqual([ids[4], ids[3]]);
		expect(page1.hasMore).toBe(true);
		const page2 = await listNotifications(user.id, { limit: 2, before: ids[3] });
		expect(page2.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
		expect(page2.hasMore).toBe(true);
		const page3 = await listNotifications(user.id, { limit: 2, before: ids[1] });
		expect(page3.items.map((i) => i.id)).toEqual([ids[0]]);
		expect(page3.hasMore).toBe(false);
	});

	it('has no more when the page is exactly full', async () => {
		const user = await testUser();
		await seed(user.id);
		await seed(user.id);
		expect((await listNotifications(user.id, { limit: 2 })).hasMore).toBe(false);
	});

	it('defaults to 50 per page', async () => {
		const user = await testUser();
		await db
			.insert(notifications)
			.values(Array.from({ length: 51 }, () => ({ userId: user.id, kind: 'comment' })));
		const { items, hasMore } = await listNotifications(user.id, {});
		expect(items).toHaveLength(50);
		expect(hasMore).toBe(true);
	});

	it('continues below the before row even after a coalesced bump moved an old id up', async () => {
		const user = await testUser();
		const actor = await testUser();
		const mediaId = await insertMeme(user.id);
		const old = await seed(user.id, {
			mediaId,
			actorId: actor.id,
			updatedAt: at('2026-10-01T10:00:00Z')
		});
		const mid = await seed(user.id, { updatedAt: at('2026-10-02T10:00:00Z') });
		const low = await seed(user.id, { updatedAt: at('2026-10-01T09:00:00Z') });
		// the oldest row is bumped by a new comment: it now sorts first although its id is smallest
		await notify(db, { userId: user.id, kind: 'comment', actorId: actor.id, mediaId });
		const first = await listNotifications(user.id, { limit: 1 });
		expect(first.items.map((i) => i.id)).toEqual([old]);
		const next = await listNotifications(user.id, { limit: 5, before: old });
		expect(next.items.map((i) => i.id)).toEqual([mid, low]);
		const after = await listNotifications(user.id, { limit: 5, before: mid });
		expect(after.items.map((i) => i.id)).toEqual([low]);
	});

	it('breaks ties on the same updatedAt by id', async () => {
		const user = await testUser();
		const same = at('2026-10-02T10:00:00Z');
		const a = await seed(user.id, { updatedAt: same });
		const b = await seed(user.id, { updatedAt: same });
		const c = await seed(user.id, { updatedAt: same });
		const { items } = await listNotifications(user.id, { before: c });
		expect(items.map((i) => i.id)).toEqual([b, a]);
	});

	it('does not lose a row whose updatedAt differs from the cursor only below a millisecond', async () => {
		const user = await testUser();
		const hi = await seed(user.id);
		const lo = await seed(user.id);
		await db.execute(
			sql`UPDATE notifications SET updated_at = '2026-10-02 10:00:00.000900+00' WHERE id = ${hi}`
		);
		await db.execute(
			sql`UPDATE notifications SET updated_at = '2026-10-02 10:00:00.000100+00' WHERE id = ${lo}`
		);
		const { items } = await listNotifications(user.id, { before: hi });
		expect(items.map((i) => i.id)).toEqual([lo]);
	});

	it('returns the first page for an unknown before', async () => {
		const user = await testUser();
		const a = await seed(user.id);
		const b = await seed(user.id);
		const { items } = await listNotifications(user.id, { before: 99999 });
		expect(items.map((i) => i.id)).toEqual([b, a]);
	});

	it("returns the first page for another user's before", async () => {
		const user = await testUser();
		const other = await testUser();
		const foreign = await seed(other.id);
		const a = await seed(user.id);
		expect((await listNotifications(user.id, { before: foreign })).items.map((i) => i.id)).toEqual([
			a
		]);
	});
});

describe('openNotification', () => {
	it('leads to the meme while mediaId is set, and marks the notice read', async () => {
		const user = await testUser();
		const mediaId = await insertMeme(user.id);
		const id = await seed(user.id, { kind: 'comment', mediaId });
		expect(await openNotification(user.id, id)).toBe(`/meme/${mediaId}`);
		expect(await countUnread(user.id)).toBe(0);
		const [row] = await rows();
		expect(row.readAt).not.toBeNull();
	});

	it('does not move updatedAt when opening', async () => {
		const user = await testUser();
		const id = await seed(user.id, { updatedAt: at('2026-10-02T10:00:00Z') });
		await openNotification(user.id, id);
		expect((await rows())[0].updatedAt).toEqual(at('2026-10-02T10:00:00Z'));
	});

	it('leads to /quotes while the quote exists', async () => {
		const user = await testUser();
		const quoteId = await insertQuote(user.id);
		const id = await seed(user.id, {
			kind: 'report_resolved',
			contentType: 'quote',
			contentId: quoteId
		});
		expect(await openNotification(user.id, id)).toBe('/quotes');
	});

	it('falls back to /notifications once the quote is gone', async () => {
		const user = await testUser();
		const id = await seed(user.id, {
			kind: 'report_resolved',
			contentType: 'quote',
			contentId: 4242
		});
		expect(await openNotification(user.id, id)).toBe('/notifications');
	});

	it('does not treat a comment id as a quote id', async () => {
		const user = await testUser();
		const quoteId = await insertQuote(user.id);
		const id = await seed(user.id, {
			kind: 'content_released',
			contentType: 'comment',
			contentId: quoteId
		});
		expect(await openNotification(user.id, id)).toBe('/notifications');
	});

	it.each(['name_changed', 'name_reset', 'avatar_removed', 'motto_cleared'] as const)(
		'leads %s to /profile/edit',
		async (kind) => {
			const user = await testUser();
			const id = await seed(user.id, { kind });
			expect(await openNotification(user.id, id)).toBe('/profile/edit');
		}
	);

	it('leads timeout_set to /rules', async () => {
		const user = await testUser();
		const id = await seed(user.id, { kind: 'timeout_set' });
		expect(await openNotification(user.id, id)).toBe('/rules');
	});

	it.each(['content_deleted', 'timeout_lifted'] as const)(
		'leads %s back to /notifications',
		async (kind) => {
			const user = await testUser();
			const id = await seed(user.id, { kind, contentType: 'comment', contentId: 1 });
			expect(await openNotification(user.id, id)).toBe('/notifications');
			expect(await countUnread(user.id)).toBe(0);
		}
	);

	it('returns null for an unknown id', async () => {
		const user = await testUser();
		expect(await openNotification(user.id, 12345)).toBeNull();
	});

	it("returns null for someone else's id and marks nothing", async () => {
		const user = await testUser();
		const other = await testUser();
		const id = await seed(other.id);
		expect(await openNotification(user.id, id)).toBeNull();
		expect(await countUnread(other.id)).toBe(1);
	});

	it('keeps the original read time when opened twice', async () => {
		const user = await testUser();
		const id = await seed(user.id, { readAt: at('2026-10-02T10:00:00Z') });
		await openNotification(user.id, id);
		expect((await rows())[0].readAt).toEqual(at('2026-10-02T10:00:00Z'));
	});
});

describe('markAllRead', () => {
	it('marks only the own unread rows', async () => {
		const user = await testUser();
		const other = await testUser();
		await seed(user.id);
		await seed(user.id);
		await seed(other.id);
		await markAllRead(user.id);
		expect(await countUnread(user.id)).toBe(0);
		expect(await countUnread(other.id)).toBe(1);
	});
});

describe('preferences', () => {
	it('defaults to everything on without a row', async () => {
		const user = await testUser();
		expect(await getPrefs(user.id)).toEqual({
			comments: true,
			threadComments: true,
			reportOutcomes: true
		});
	});

	it('upserts', async () => {
		const user = await testUser();
		await setPrefs(user.id, { comments: false, threadComments: true, reportOutcomes: false });
		expect(await getPrefs(user.id)).toEqual({
			comments: false,
			threadComments: true,
			reportOutcomes: false
		});
		await setPrefs(user.id, { comments: true, threadComments: false, reportOutcomes: true });
		expect(await getPrefs(user.id)).toEqual({
			comments: true,
			threadComments: false,
			reportOutcomes: true
		});
		expect(await db.select().from(notificationPrefs)).toHaveLength(1);
	});

	it('is per user', async () => {
		const user = await testUser();
		const other = await testUser();
		await setPrefs(user.id, { comments: false, threadComments: false, reportOutcomes: false });
		expect((await getPrefs(other.id)).comments).toBe(true);
	});
});

describe('sweepNotifications', () => {
	it('deletes rows older than 90 days, read or not, and keeps younger ones', async () => {
		const user = await testUser();
		const now = at('2026-10-28T12:00:00Z');
		const old = await seed(user.id, { updatedAt: new Date(now.getTime() - 91 * DAY) });
		const oldRead = await seed(user.id, {
			updatedAt: new Date(now.getTime() - 120 * DAY),
			readAt: now
		});
		const fresh = await seed(user.id, { updatedAt: new Date(now.getTime() - 89 * DAY) });
		expect(await sweepNotifications(90, now)).toBe(2);
		expect((await rows()).map((r) => r.id)).toEqual([fresh]);
		expect([old, oldRead]).not.toContain(fresh);
	});

	it('goes by updatedAt, not createdAt', async () => {
		const user = await testUser();
		const now = at('2026-10-28T12:00:00Z');
		await seed(user.id, {
			createdAt: new Date(now.getTime() - 200 * DAY),
			updatedAt: new Date(now.getTime() - DAY)
		});
		expect(await sweepNotifications(90, now)).toBe(0);
	});

	it('returns 0 for nothing to delete and defaults to the present', async () => {
		const user = await testUser();
		await seed(user.id);
		expect(await sweepNotifications()).toBe(0);
	});
});

describe('cascades', () => {
	it('deleting the meme takes the notices that lead to it', async () => {
		const user = await testUser();
		const mediaId = await insertMeme(user.id);
		await seed(user.id, { kind: 'comment', mediaId });
		const kept = await seed(user.id, {
			kind: 'content_deleted',
			contentType: 'comment',
			contentId: 1
		});
		await db.delete(media).where(eq(media.id, mediaId));
		expect((await rows()).map((r) => r.id)).toEqual([kept]);
	});

	it('a notice survives the deletion of the content it points at', async () => {
		const user = await testUser();
		const mediaId = await insertMeme(user.id);
		const commentId = await insertComment(user.id, mediaId);
		await seed(user.id, { kind: 'content_deleted', contentType: 'comment', contentId: commentId });
		await db.delete(media).where(eq(media.id, mediaId));
		expect(await rows()).toHaveLength(1);
	});

	it('deleting the actor nulls actorId and the item shows no actor', async () => {
		const user = await testUser();
		const actor = await testUser();
		await seed(user.id, { actorId: actor.id });
		await db.delete(users).where(eq(users.id, actor.id));
		const [row] = await rows();
		expect(row.actorId).toBeNull();
		const [item] = (await listNotifications(user.id, {})).items;
		expect(item.actor).toBeNull();
	});

	it('deleting the recipient removes their notices and prefs', async () => {
		const user = await testUser();
		await seed(user.id);
		await setPrefs(user.id, { comments: false, threadComments: true, reportOutcomes: true });
		await db.delete(users).where(eq(users.id, user.id));
		expect(await rows()).toHaveLength(0);
		expect(await db.select().from(notificationPrefs)).toHaveLength(0);
	});
});
