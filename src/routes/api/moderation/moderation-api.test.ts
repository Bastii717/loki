import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import {
	auditLog,
	comments,
	media,
	quotes,
	reports,
	timeouts
} from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { activeTimeout } from '../../../lib/server/moderation';
import {
	addOpenReports,
	insertComment,
	insertMeme,
	insertMemeRow,
	insertQuote,
	OVER_THRESHOLD,
	userWithSession
} from '../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../lib/server/rate-limit';
import { ensureBucket } from '../../../lib/server/storage-test-utils';
import { callRoute } from '../../../lib/server/test-request';
import { load as memeLoad } from '../../meme/[pid]/+page.server';
import { load as moderationQueue } from '../../moderation/+page.server';
import { GET as feed } from '../feed/+server';
import { POST as report } from '../report/+server';
import { POST as caseAction } from './case/+server';
import { POST as setTimeoutRoute } from './timeouts/+server';
import { DELETE as liftTimeoutRoute } from './timeouts/[pid]/+server';
import { GET as searchUsers } from './users/+server';

beforeAll(async () => {
	await setupDb();
	await ensureBucket(); // deleting a meme removes its bucket objects
});
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

type ContentType = 'meme' | 'comment' | 'quote';

async function world() {
	const [author, mod, admin, member] = await Promise.all([
		userWithSession('member'),
		userWithSession('moderator'),
		userWithSession('admin'),
		userWithSession('member')
	]);
	const meme = await insertMemeRow(author.user.id, 'Gemeldetes Meme');
	const memeId = meme.id;
	const commentId = await insertComment(author.user.id, memeId, 'Gemeldeter Kommentar');
	const quoteId = await insertQuote(author.user.id, 'Gemeldetes Zitat');
	const ids = { meme: memeId, comment: commentId, quote: quoteId };
	const excerpts = {
		meme: 'Gemeldetes Meme',
		comment: 'Gemeldeter Kommentar',
		quote: 'Gemeldetes Zitat'
	};
	for (const [type, id] of Object.entries(ids)) {
		await addOpenReports(type as ContentType, id, author.user.id, 2);
		await db
			.update(reports)
			.set({ excerpt: excerpts[type as ContentType] })
			.where(and(eq(reports.contentType, type as ContentType), eq(reports.contentId, id)));
	}
	// clients (feed, report API, meme page) address the meme by its public id
	return { author, mod, admin, member, ids, memePid: meme.publicId };
}

const act = (session: string, body: unknown) =>
	callRoute({
		handler: caseAction,
		path: '/api/moderation/case',
		method: 'POST',
		session,
		body
	});

const openReports = (type: ContentType, id: number) =>
	db
		.select()
		.from(reports)
		.where(
			and(eq(reports.contentType, type), eq(reports.contentId, id), eq(reports.status, 'open'))
		);

const resolvedReports = (type: ContentType, id: number) =>
	db
		.select()
		.from(reports)
		.where(
			and(eq(reports.contentType, type), eq(reports.contentId, id), eq(reports.status, 'resolved'))
		);

const auditFor = (action: string, targetType: string, targetId: number) =>
	db
		.select()
		.from(auditLog)
		.where(
			and(
				eq(auditLog.action, action),
				eq(auditLog.targetType, targetType),
				eq(auditLog.targetId, targetId)
			)
		);

const totalAudit = async () => (await db.select().from(auditLog)).length;

describe('release (Freigeben)', () => {
	it.each(['meme', 'comment', 'quote'] as const)(
		'%s: closes the reports as dismissed, stamps reviewedAt and logs exactly one report_dismissed',
		async (type) => {
			const w = await world();
			const { response } = await act(w.mod.session, {
				contentType: type,
				contentId: w.ids[type],
				action: 'release'
			});
			expect(response.status).toBe(204);

			expect(await openReports(type, w.ids[type])).toHaveLength(0);
			const closed = await resolvedReports(type, w.ids[type]);
			expect(closed).toHaveLength(2);
			expect(closed.every((r) => r.outcome === 'dismissed' && r.resolvedBy === w.mod.user.id)).toBe(
				true
			);
			const table = { meme: media, comment: comments, quote: quotes }[type];
			const [row] = await db.select().from(table).where(eq(table.id, w.ids[type]));
			expect(row.reviewedAt).not.toBeNull();

			const rows = await auditFor('report_dismissed', type, w.ids[type]);
			expect(rows).toHaveLength(1);
			expect(rows[0].actorId).toBe(w.mod.user.id);
			expect(await auditFor('content_released', type, w.ids[type])).toHaveLength(0);
		}
	);

	it('a second action on the same case gets 404 and changes nothing', async () => {
		const w = await world();
		const body = { contentType: 'meme', contentId: w.ids.meme, action: 'release' };
		expect((await act(w.mod.session, body)).response.status).toBe(204);
		const audits = await totalAudit();
		for (const action of ['release', 'delete', 'flags']) {
			expect((await act(w.mod.session, { ...body, action })).response.status).toBe(404);
		}
		expect(await totalAudit()).toBe(audits);
		expect(await db.select().from(media).where(eq(media.id, w.ids.meme))).toHaveLength(1);
	});

	it('an admin may act as well', async () => {
		const w = await world();
		const { response } = await act(w.admin.session, {
			contentType: 'comment',
			contentId: w.ids.comment,
			action: 'release'
		});
		expect(response.status).toBe(204);
	});
});

describe('force NSFW blur (flags)', () => {
	it('sets nsfw, closes the reports as actioned and logs flags_forced once, without a dismissal', async () => {
		const w = await world();
		const { response } = await act(w.mod.session, {
			contentType: 'meme',
			contentId: w.ids.meme,
			action: 'flags'
		});
		expect(response.status).toBe(204);

		const [row] = await db.select().from(media).where(eq(media.id, w.ids.meme));
		expect(row.nsfw).toBe(true);
		expect(row.reviewedAt).toBeNull(); // not a release: no immunity
		const closed = await resolvedReports('meme', w.ids.meme);
		expect(closed.map((r) => r.outcome)).toEqual(['actioned', 'actioned']);
		const rows = await auditFor('flags_forced', 'meme', w.ids.meme);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ actorId: w.mod.user.id });
		expect(rows[0].detail).toContain('Gemeldetes Meme');
		expect(await auditFor('report_dismissed', 'meme', w.ids.meme)).toHaveLength(0);
	});

	it.each(['comment', 'quote'] as const)(
		'is rejected for a %s (400) and leaves the case open',
		async (type) => {
			const w = await world();
			const { response } = await act(w.mod.session, {
				contentType: type,
				contentId: w.ids[type],
				action: 'flags'
			});
			expect(response.status).toBe(400);
			expect(await openReports(type, w.ids[type])).toHaveLength(2);
			expect(await totalAudit()).toBe(0);
		}
	);
});

describe('delete', () => {
	it.each(['meme', 'comment', 'quote'] as const)(
		'%s: removes the content, closes the reports as actioned, logs content_deleted with the excerpt',
		async (type) => {
			const w = await world();
			const { response } = await act(w.mod.session, {
				contentType: type,
				contentId: w.ids[type],
				action: 'delete'
			});
			expect(response.status).toBe(204);

			const table = { meme: media, comment: comments, quote: quotes }[type];
			expect(await db.select().from(table).where(eq(table.id, w.ids[type]))).toHaveLength(0);
			const closed = await resolvedReports(type, w.ids[type]);
			expect(closed).toHaveLength(2);
			expect(closed.every((r) => r.outcome === 'actioned')).toBe(true);
			const rows = await auditFor('content_deleted', type, w.ids[type]);
			expect(rows).toHaveLength(1);
			expect(rows[0].actorId).toBe(w.mod.user.id);
			expect(rows[0].detail).toContain(w.author.user.username);
			expect(rows[0].detail).toContain(
				{ meme: 'Gemeldetes Meme', comment: 'Gemeldeter Kommentar', quote: 'Gemeldetes Zitat' }[
					type
				]
			);
		}
	);

	it('finishes a half-completed delete: content already gone, the case is still closed and audited', async () => {
		const w = await world();
		await db.delete(comments).where(eq(comments.id, w.ids.comment));
		const { response } = await act(w.mod.session, {
			contentType: 'comment',
			contentId: w.ids.comment,
			action: 'delete'
		});
		expect(response.status).toBe(204);
		expect(await openReports('comment', w.ids.comment)).toHaveLength(0);
		expect((await resolvedReports('comment', w.ids.comment)).map((r) => r.outcome)).toEqual([
			'actioned',
			'actioned'
		]);
		expect(await auditFor('content_deleted', 'comment', w.ids.comment)).toHaveLength(1);
	});

	it('answers 404 for flags on a meme that is gone and keeps the case open for release', async () => {
		const w = await world();
		await db.delete(media).where(eq(media.id, w.ids.meme));
		const body = { contentType: 'meme', contentId: w.ids.meme };
		const { response } = await act(w.mod.session, { ...body, action: 'flags' });
		expect(response.status).toBe(404);
		expect(await openReports('meme', w.ids.meme)).toHaveLength(2);
		expect(await auditFor('flags_forced', 'meme', w.ids.meme)).toHaveLength(0);
		expect((await act(w.mod.session, { ...body, action: 'release' })).response.status).toBe(204);
		expect(await openReports('meme', w.ids.meme)).toHaveLength(0);
	});
});

describe('timeout from a case', () => {
	it('times the author out, closes the reports as actioned, logs timeout_set (once) and no deletion', async () => {
		const w = await world();
		const { response } = await act(w.mod.session, {
			contentType: 'meme',
			contentId: w.ids.meme,
			action: 'timeout',
			days: 3,
			reason: 'Wiederholt beleidigend'
		});
		expect(response.status).toBe(204);

		expect(await activeTimeout(w.author.user.id)).toMatchObject({
			reason: 'Wiederholt beleidigend'
		});
		expect((await resolvedReports('meme', w.ids.meme)).map((r) => r.outcome)).toEqual([
			'actioned',
			'actioned'
		]);
		const rows = await auditFor('timeout_set', 'user', w.author.user.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].detail).toBe('3 days: Wiederholt beleidigend');
		expect(await db.select().from(media).where(eq(media.id, w.ids.meme))).toHaveLength(1);
		// the other cases of the same author stay open
		expect(await openReports('comment', w.ids.comment)).toHaveLength(2);
	});

	it.each([
		['no days', { reason: 'x' }],
		['days 0', { days: 0, reason: 'x' }],
		['days 31', { days: 31, reason: 'x' }],
		['fractional days', { days: 1.5, reason: 'x' }],
		['string days', { days: '3', reason: 'x' }],
		['no reason', { days: 3 }],
		['blank reason', { days: 3, reason: '   ' }],
		['reason too long', { days: 3, reason: 'x'.repeat(501) }]
	])('rejects invalid input (%s) with 400 and changes nothing', async (_name, extra) => {
		const w = await world();
		const { response } = await act(w.mod.session, {
			contentType: 'meme',
			contentId: w.ids.meme,
			action: 'timeout',
			...extra
		});
		expect(response.status).toBe(400);
		expect(await activeTimeout(w.author.user.id)).toBeNull();
		expect(await openReports('meme', w.ids.meme)).toHaveLength(2);
	});

	it('a moderator cannot time out a moderator author (403); an admin can', async () => {
		const w = await world();
		const modAuthor = await userWithSession('moderator');
		const memeId = await insertMeme(modAuthor.user.id);
		await addOpenReports('meme', memeId, modAuthor.user.id, 1);
		const body = {
			contentType: 'meme',
			contentId: memeId,
			action: 'timeout',
			days: 2,
			reason: 'Test'
		};
		const denied = await act(w.mod.session, body);
		expect(denied.response.status).toBe(403);
		expect(await activeTimeout(modAuthor.user.id)).toBeNull();
		expect(await openReports('meme', memeId)).toHaveLength(1);

		expect((await act(w.admin.session, body)).response.status).toBe(204);
		expect(await activeTimeout(modAuthor.user.id)).not.toBeNull();
	});

	it('a moderator cannot time themselves out through a case about their own content (400)', async () => {
		const w = await world();
		const memeId = await insertMeme(w.mod.user.id);
		await addOpenReports('meme', memeId, w.mod.user.id, 1);
		const { response } = await act(w.mod.session, {
			contentType: 'meme',
			contentId: memeId,
			action: 'timeout',
			days: 2,
			reason: 'Test'
		});
		expect(response.status).toBe(400);
		expect(await openReports('meme', memeId)).toHaveLength(1);
	});
});

describe('self-dealing: cases about the own content of the actor', () => {
	const OWN_MESSAGE = 'Reports on your own content are decided by another team member.';

	async function ownCase(role: 'moderator' | 'admin') {
		const w = await world();
		const me = role === 'moderator' ? w.mod : w.admin;
		const memeId = await insertMeme(me.user.id, 'Mein Meme');
		await addOpenReports('meme', memeId, me.user.id, OVER_THRESHOLD);
		return { w, me, memeId };
	}

	it.each(['moderator', 'admin'] as const)(
		'%s: release and force-flags on the own content are 403, reports stay open, no immunity',
		async (role) => {
			const { w, me, memeId } = await ownCase(role);
			const audits = await totalAudit();
			for (const action of ['release', 'flags']) {
				const { response } = await act(me.session, {
					contentType: 'meme',
					contentId: memeId,
					action
				});
				expect(response.status).toBe(403);
				expect(await response.text()).toBe(OWN_MESSAGE);
			}
			expect(await openReports('meme', memeId)).toHaveLength(OVER_THRESHOLD);
			const [row] = await db.select().from(media).where(eq(media.id, memeId));
			expect(row.reviewedAt).toBeNull();
			expect(row.nsfw).toBe(false);
			expect(await totalAudit()).toBe(audits);
			void w;
		}
	);

	it('another moderator can still release it', async () => {
		const { w, memeId } = await ownCase('moderator');
		const { response } = await act(w.admin.session, {
			contentType: 'meme',
			contentId: memeId,
			action: 'release'
		});
		expect(response.status).toBe(204);
		const [row] = await db.select().from(media).where(eq(media.id, memeId));
		expect(row.reviewedAt).not.toBeNull();
	});

	it('deleting the own content is allowed and closes the reports as removed, without a mod audit row', async () => {
		const { me, memeId } = await ownCase('moderator');
		const { response } = await act(me.session, {
			contentType: 'meme',
			contentId: memeId,
			action: 'delete'
		});
		expect(response.status).toBe(204);
		expect(await db.select().from(media).where(eq(media.id, memeId))).toHaveLength(0);
		const closed = await resolvedReports('meme', memeId);
		expect(closed).toHaveLength(OVER_THRESHOLD);
		expect(closed.every((r) => r.outcome === 'removed')).toBe(true);
		expect(await auditFor('content_deleted', 'meme', memeId)).toHaveLength(0);
	});
});

describe('request validation', () => {
	it.each([
		['not json', undefined],
		['null body', null],
		['unknown action', { contentType: 'meme', contentId: 1, action: 'ban' }],
		['no action', { contentType: 'meme', contentId: 1 }],
		['bad contentType', { contentType: 'user', contentId: 1, action: 'release' }],
		['prototype contentType', { contentType: '__proto__', contentId: 1, action: 'release' }],
		['string id', { contentType: 'meme', contentId: '1', action: 'release' }],
		['negative id', { contentType: 'meme', contentId: -1, action: 'release' }],
		['fractional id', { contentType: 'meme', contentId: 1.5, action: 'release' }]
	])('%s -> 400', async (_name, body) => {
		const w = await world();
		const { response } = await act(w.mod.session, body);
		expect(response.status).toBe(400);
		expect(await totalAudit()).toBe(0);
	});

	it('an unknown case is 404', async () => {
		const w = await world();
		const { response } = await act(w.mod.session, {
			contentType: 'meme',
			contentId: 999999,
			action: 'release'
		});
		expect(response.status).toBe(404);
	});
});

describe('Review Focus 5: release grants immunity', () => {
	it('threshold+1 fresh reports after a release leave the content visible, but reach the queue', async () => {
		const w = await world();
		// push the meme over the threshold: hidden for members, visible to mods
		await addOpenReports('meme', w.ids.meme, w.author.user.id, OVER_THRESHOLD);
		const itemFor = async (session: string) => {
			const { response } = await callRoute({ handler: feed, path: '/api/feed', session });
			const { items } = (await response.json()) as {
				items: { id: string; title: string; mediaUrl: string | null; underReview: boolean }[];
			};
			return items.find((i) => i.id === w.memePid)!;
		};
		expect(await itemFor(w.member.session)).toMatchObject({ mediaUrl: null, underReview: true });

		const release = await act(w.mod.session, {
			contentType: 'meme',
			contentId: w.ids.meme,
			action: 'release'
		});
		expect(release.response.status).toBe(204);
		expect(await itemFor(w.member.session)).toMatchObject({
			title: 'Gemeldetes Meme',
			underReview: false
		});

		// threshold+1 fresh reporters report through the real API
		for (let i = 0; i < OVER_THRESHOLD; i++) {
			const reporter = await userWithSession('member');
			const { response } = await callRoute({
				handler: report,
				path: '/api/report',
				method: 'POST',
				session: reporter.session,
				body: { contentType: 'meme', contentId: w.memePid, category: 'spam' }
			});
			expect(response.status).toBe(204);
		}

		expect(await openReports('meme', w.ids.meme)).toHaveLength(OVER_THRESHOLD);
		const after = await itemFor(w.member.session);
		expect(after).toMatchObject({ title: 'Gemeldetes Meme', underReview: false });
		expect(after.mediaUrl).not.toBeNull();
		// the detail page shows it too
		const detail = (await memeLoad({
			params: { pid: w.memePid },
			locals: { user: w.member.user }
		} as never)) as { item: { mediaUrl: string | null; underReview: boolean } };
		expect(detail.item.underReview).toBe(false);
		expect(detail.item.mediaUrl).not.toBeNull();

		// ...and the new reports are a case again for the moderators
		const queue = (await moderationQueue({
			locals: { user: w.mod.user },
			url: new URL('https://loki.test/moderation')
		} as never)) as { cases: { contentId: number; contentType: string; reports: unknown[] }[] };
		const again = queue.cases.find((c) => c.contentType === 'meme' && c.contentId === w.ids.meme);
		expect(again?.reports).toHaveLength(OVER_THRESHOLD);
	});

	it('a force-flags resolution is NOT a release: later reports can hide the content again', async () => {
		const w = await world();
		await act(w.mod.session, { contentType: 'meme', contentId: w.ids.meme, action: 'flags' });
		await addOpenReports('meme', w.ids.meme, w.author.user.id, OVER_THRESHOLD);
		const { response } = await callRoute({
			handler: feed,
			path: '/api/feed',
			session: w.member.session
		});
		const { items } = (await response.json()) as { items: { id: string; underReview: boolean }[] };
		expect(items.find((i) => i.id === w.memePid)?.underReview).toBe(true);
	});
});

describe('timeouts API', () => {
	const setTimeoutCall = (session: string, body: unknown) =>
		callRoute({
			handler: setTimeoutRoute,
			path: '/api/moderation/timeouts',
			method: 'POST',
			session,
			body
		});
	const liftCall = (session: string, pid: string) =>
		callRoute({
			handler: liftTimeoutRoute,
			path: `/api/moderation/timeouts/${pid}`,
			method: 'DELETE',
			params: { pid },
			session
		});

	it('sets, replaces and lifts a timeout with audit rows', async () => {
		const w = await world();
		const target = w.author.user.id;
		const pid = w.author.publicId;
		expect(
			(await setTimeoutCall(w.mod.session, { userId: pid, days: 2, reason: 'Streit' })).response
				.status
		).toBe(204);
		expect(await activeTimeout(target)).toMatchObject({ reason: 'Streit' });

		expect(
			(await setTimeoutCall(w.admin.session, { userId: pid, days: 5, reason: 'Once more' }))
				.response.status
		).toBe(204);
		expect(await activeTimeout(target)).toMatchObject({ reason: 'Once more' });
		expect(await auditFor('timeout_lifted', 'user', target)).toHaveLength(1); // the replaced one
		expect(await auditFor('timeout_set', 'user', target)).toHaveLength(2);

		expect((await liftCall(w.mod.session, pid)).response.status).toBe(204);
		expect(await activeTimeout(target)).toBeNull();
		expect(await auditFor('timeout_lifted', 'user', target)).toHaveLength(2);
		expect(await db.select().from(timeouts).where(eq(timeouts.userId, target))).toHaveLength(2);

		// nothing active left to lift
		expect((await liftCall(w.mod.session, pid)).response.status).toBe(404);
	});

	it('enforces the role matrix: no self, moderators only on members', async () => {
		const w = await world();
		const otherMod = await userWithSession('moderator');
		const send = (session: string, userId: string) =>
			setTimeoutCall(session, { userId, days: 1, reason: 'x' });
		expect((await send(w.mod.session, w.mod.publicId)).response.status).toBe(400);
		expect((await send(w.mod.session, otherMod.publicId)).response.status).toBe(403);
		expect((await send(w.mod.session, w.admin.publicId)).response.status).toBe(403);
		expect((await send(w.admin.session, otherMod.publicId)).response.status).toBe(204);
		// a moderator cannot lift a moderator's timeout either
		expect((await liftCall(w.mod.session, otherMod.publicId)).response.status).toBe(403);
		expect(await activeTimeout(otherMod.user.id)).not.toBeNull();
		expect((await liftCall(w.admin.session, otherMod.publicId)).response.status).toBe(204);
	});

	it.each([
		['no user', { days: 1, reason: 'x' }],
		['numeric user', { userId: 2, days: 1, reason: 'x' }],
		['numeric string user', { userId: '2', days: 1, reason: 'x' }],
		['short user id', { userId: 'abcdefghijk', days: 1, reason: 'x' }],
		['days 0', { userId: 'AAAAAAAAAAAA', days: 0, reason: 'x' }],
		['days 31', { userId: 'AAAAAAAAAAAA', days: 31, reason: 'x' }],
		['no reason', { userId: 'AAAAAAAAAAAA', days: 1 }],
		['blank reason', { userId: 'AAAAAAAAAAAA', days: 1, reason: ' ' }]
	])('rejects invalid input (%s) with 400', async (_name, body) => {
		const w = await world();
		expect((await setTimeoutCall(w.mod.session, body)).response.status).toBe(400);
		expect(await db.select().from(timeouts)).toHaveLength(0);
	});

	it('unknown user is 404, and so is every lift id that is not a known public id', async () => {
		const w = await world();
		expect(
			(await setTimeoutCall(w.mod.session, { userId: 'AAAAAAAAAAAA', days: 1, reason: 'x' }))
				.response.status
		).toBe(404);
		for (const pid of ['abc', '1', String(w.author.user.id), 'AAAAAAAAAAAA']) {
			expect((await liftCall(w.mod.session, pid)).response.status).toBe(404);
		}
		expect(await db.select().from(timeouts)).toHaveLength(0);
	});

	it('does not time out by internal id', async () => {
		const w = await world();
		const { response } = await setTimeoutCall(w.mod.session, {
			userId: String(w.author.user.id),
			days: 1,
			reason: 'x'
		});
		expect(response.status).toBe(400);
		expect(await activeTimeout(w.author.user.id)).toBeNull();
	});
});

describe('user search for the timeout picker', () => {
	it('finds users by name and says whom the caller may time out', async () => {
		const w = await world();
		const search = async (session: string, q: string) => {
			const { response } = await callRoute({
				handler: searchUsers,
				path: `/api/moderation/users?q=${encodeURIComponent(q)}`,
				session
			});
			expect(response.status).toBe(200);
			return (
				(await response.json()) as {
					users: { id: string; username: string; role: string; timeoutable: boolean }[];
				}
			).users;
		};
		const asMod = await search(w.mod.session, '');
		const byId = Object.fromEntries(asMod.map((u) => [u.id, u]));
		expect(byId[w.author.publicId]).toMatchObject({ role: 'member', timeoutable: true });
		expect(byId[w.mod.publicId].timeoutable).toBe(false); // self
		expect(byId[w.admin.publicId].timeoutable).toBe(false); // above a moderator
		// the hits carry public ids only
		expect(JSON.stringify(asMod)).not.toMatch(/"id":\d/);
		const asAdmin = await search(w.admin.session, w.mod.user.username);
		expect(asAdmin.find((u) => u.id === w.mod.publicId)?.timeoutable).toBe(true);
		expect(asAdmin.find((u) => u.id === w.admin.publicId)).toBeUndefined();
		expect(await search(w.mod.session, 'no-such-user')).toEqual([]);
	});
});
