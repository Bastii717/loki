import { render } from 'svelte/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, setupDb } from '../../lib/server/db/test-utils';
import { audit, AUDIT_ACTIONS, resolveReports } from '../../lib/server/moderation';
import type { OpenCase } from '../../lib/server/moderation-queries';
import {
	addOpenReports,
	insertCommentRow,
	insertMemeRow,
	insertQuoteRow,
	userWithSession
} from '../../lib/server/moderation-test-utils';
import { load as queue } from './+page.server';
import CaseCard from './CaseCard.svelte';
import { load as log } from './log/+page.server';
import { load as resolved } from './resolved/+page.server';

vi.mock('$app/navigation', () => ({ invalidateAll: async () => {} }));

beforeAll(setupDb);
beforeEach(resetDb);

type Session = Awaited<ReturnType<typeof userWithSession>>;

/** An open case of each kind (meme, comment, quote), all authored by `author`. */
async function cases(author: Session) {
	const meme = await insertMemeRow(author.user.id, 'Gemeldet');
	const comment = await insertCommentRow(author.user.id, meme.id, 'Kommentar');
	const quote = await insertQuoteRow(author.user.id, 'Zitat');
	await addOpenReports('meme', meme.id, author.user.id, 1);
	await addOpenReports('comment', comment.id, author.user.id, 1);
	await addOpenReports('quote', quote.id, author.user.id, 1);
	return { meme, comment, quote };
}

const loadQueue = (mod: Session) =>
	queue({
		locals: { user: mod.user },
		url: new URL('https://loki.test/moderation')
	} as never) as Promise<{
		cases: OpenCase[];
		nextCursor: number | null;
		viewer: { id: string; role: string };
	}>;

describe('moderation queue payload', () => {
	it('carries public ids for the viewer, authors, reporters and previews', async () => {
		const mod = await userWithSession('moderator');
		const author = await userWithSession();
		const { meme } = await cases(author);
		const data = await loadQueue(mod);

		expect(data.viewer).toEqual({ id: mod.publicId, role: 'moderator' });
		expect(data.cases).toHaveLength(3);
		for (const c of data.cases) expect(c.authorId).toBe(author.publicId);
		const memeCase = data.cases.find((c) => c.contentType === 'meme')!;
		expect(memeCase.preview).toMatchObject({ type: 'meme', id: meme.publicId });
		const commentCase = data.cases.find((c) => c.contentType === 'comment')!;
		expect(commentCase.preview).toMatchObject({ type: 'comment', mediaId: meme.publicId });
		for (const c of data.cases) {
			for (const r of c.reports) expect(r.reporterId).toMatch(/^[A-Za-z0-9]{12}$/);
		}
	});

	it('keeps contentId as the only internal id, for the case round-trip', async () => {
		const mod = await userWithSession('moderator');
		const author = await userWithSession();
		const { meme } = await cases(author);
		const data = await loadQueue(mod);
		expect(data.cases.find((c) => c.contentType === 'meme')!.contentId).toBe(meme.id);
		const stripped = JSON.parse(JSON.stringify(data), (key, value) =>
			key === 'contentId' ? undefined : value
		);
		expect(JSON.stringify(stripped)).not.toMatch(/"(authorId|reporterId|mediaId|id|userId)":\d/);
	});
});

describe('resolved cases payload', () => {
	it('has no internal content or user id at all', async () => {
		const mod = await userWithSession('moderator');
		const author = await userWithSession();
		const { meme, comment } = await cases(author);
		await resolveReports(mod.user, 'meme', meme.id, 'dismissed');
		await resolveReports(mod.user, 'comment', comment.id, 'actioned');
		const data = (await resolved({
			locals: { user: mod.user },
			url: new URL('https://loki.test/moderation/resolved')
		} as never)) as { cases: { id: number; authorId: string }[]; nextCursor: string | null };
		expect(data.cases).toHaveLength(2);
		for (const c of data.cases) expect(c.authorId).toBe(author.publicId);
		expect(JSON.stringify(data)).not.toContain('contentId');
		// `id` is the decision's first report row id (a list key); every user and content reference is public
		expect(JSON.stringify(data)).not.toMatch(/"(authorId|reporterId|mediaId|userId)":\d/);
		expect(new Set(data.cases.map((c) => c.id)).size).toBe(2);
	});
});

describe('moderation log payload', () => {
	it('shows public ids for user and content targets and none for deleted or id-less ones', async () => {
		const mod = await userWithSession('moderator');
		const author = await userWithSession();
		const { meme } = await cases(author);
		await audit(mod.user.id, AUDIT_ACTIONS.contentDeleted, 'meme', meme.id, 'still there');
		await audit(mod.user.id, AUDIT_ACTIONS.timeoutSet, 'user', author.user.id, 'x');
		await audit(mod.user.id, AUDIT_ACTIONS.contentDeleted, 'meme', 999999, 'gone');
		await audit(mod.user.id, AUDIT_ACTIONS.siteContentChanged, 'site_content', 0, 'faq');

		const data = (await log({
			locals: { user: mod.user },
			url: new URL('https://loki.test/moderation/log')
		} as never)) as {
			entries: { targetType: string; targetId: string | null; targetName: string | null }[];
		};
		const byType = (t: string) => data.entries.filter((e) => e.targetType === t);
		expect(byType('user')[0]).toMatchObject({
			targetId: author.publicId,
			targetName: author.user.username
		});
		expect(byType('meme').find((e) => e.targetId === null)).toBeDefined(); // deleted
		expect(byType('meme').find((e) => e.targetId === meme.publicId)).toBeDefined();
		expect(byType('site_content')[0].targetId).toBeNull();
		// the audit rows' own ids stay numeric (list keys), the targets never are
		expect(JSON.stringify(data)).not.toMatch(/"(targetId|authorId|mediaId|userId)":\d/);
	});
});

describe('CaseCard', () => {
	const openCase = (over: Partial<OpenCase> = {}): OpenCase => ({
		contentType: 'meme',
		contentId: 4242,
		authorId: 'AuthorPid123',
		author: 'jonas',
		authorDisplay: 'Jonas',
		authorRole: 'member',
		excerpt: 'Gemeldet',
		reports: [],
		categories: [],
		oldest: '2026-10-28T10:00:00.000Z',
		underReview: false,
		preview: {
			type: 'meme',
			id: 'MemePid12345',
			title: 'Gemeldet',
			kind: 'image',
			thumbUrl: '/media/t.webp',
			nsfw: false,
			spoiler: false
		},
		...over
	});
	const html = (item: OpenCase, viewerId = 'ModeratorPid1') =>
		render(CaseCard, { props: { item, viewer: { id: viewerId, role: 'moderator' } } }).body;

	it('links a meme case to /meme/<public id>, never to the internal content id', () => {
		const body = html(openCase());
		expect(body).toContain('href="/meme/MemePid12345"');
		expect(body).not.toContain('/meme/4242');
	});

	it('links a comment case to its meme by public id', () => {
		const body = html(
			openCase({
				contentType: 'comment',
				preview: { type: 'comment', text: 'Kommentar', mediaId: 'MemePid12345' }
			})
		);
		expect(body).toContain('href="/meme/MemePid12345"');
	});

	it('treats a case authored by the viewer (public ids) as own: no release, no timeout', () => {
		const own = html(openCase(), 'AuthorPid123');
		expect(own).toContain('Reports on your own content are decided by another team member.');
		expect(own).not.toContain('Timeout');
		const foreign = html(openCase());
		expect(foreign).not.toContain('Reports on your own content');
		expect(foreign).toContain('Timeout');
	});
});
