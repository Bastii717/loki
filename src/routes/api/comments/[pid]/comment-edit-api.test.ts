import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../lib/server/db';
import { comments } from '../../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../../lib/server/db/test-utils';
import {
	insertCommentRow,
	insertMeme,
	userWithSession
} from '../../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../../lib/server/rate-limit';
import { callRoute } from '../../../../lib/server/test-request';
import { PATCH } from './+server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

async function world() {
	const author = await userWithSession('member');
	const other = await userWithSession('member');
	const memeId = await insertMeme(author.user.id);
	const comment = await insertCommentRow(author.user.id, memeId, 'tpyo');
	return { author, other, memeId, comment };
}

const edit = (pid: string, session: string, body: unknown) =>
	callRoute({
		handler: PATCH,
		path: `/api/comments/${pid}`,
		method: 'PATCH',
		params: { pid },
		body,
		session
	});

describe('PATCH /api/comments/[pid]', () => {
	it('edits the own comment and answers with the item', async () => {
		const { author, comment } = await world();
		const { response } = await edit(comment.publicId, author.session, { text: 'typo' });
		expect(response.status).toBe(200);
		const item = (await response.json()) as { id: string; text: string; editedAt: string | null };
		expect(item).toMatchObject({ id: comment.publicId, text: 'typo' });
		expect(item.editedAt).toEqual(expect.any(String));
	});

	it('answers 403 with the reason after the window', async () => {
		const { author, comment } = await world();
		await db
			.update(comments)
			.set({ createdAt: sql`now() - interval '6 minutes'` })
			.where(eq(comments.id, comment.id));
		const { response } = await edit(comment.publicId, author.session, { text: 'typo' });
		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Comments can only be edited for 5 minutes');
	});

	it("answers 403 for someone else's comment", async () => {
		const { other, comment } = await world();
		const { response } = await edit(comment.publicId, other.session, { text: 'typo' });
		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Forbidden');
	});

	it('answers 404 for the internal id, junk and unknown ids', async () => {
		const { author, comment } = await world();
		for (const pid of [String(comment.id), 'abc', 'AAAAAAAAAAAA']) {
			expect((await edit(pid, author.session, { text: 'typo' })).response.status, pid).toBe(404);
		}
	});

	it('answers 400 for a bad body and for bad text', async () => {
		const { author, comment } = await world();
		for (const body of [undefined, {}, { text: 3 }, null, { text: '  ' }]) {
			const { response } = await edit(comment.publicId, author.session, body);
			expect(response.status, JSON.stringify(body)).toBe(400);
		}
		const { response } = await edit(comment.publicId, author.session, { text: 'x'.repeat(2001) });
		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Comment must be 1-2000 characters');
	});
});
