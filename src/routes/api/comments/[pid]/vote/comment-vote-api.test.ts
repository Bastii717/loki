import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../../../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertCommentRow,
	insertMeme,
	OVER_THRESHOLD,
	timeOut,
	userWithSession
} from '../../../../../lib/server/moderation-test-utils';
import { resetRateLimits } from '../../../../../lib/server/rate-limit';
import { callRoute } from '../../../../../lib/server/test-request';
import { POST } from './+server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

async function world() {
	const author = await userWithSession('member');
	const voter = await userWithSession('member');
	const mod = await userWithSession('moderator');
	const memeId = await insertMeme(author.user.id);
	const comment = await insertCommentRow(author.user.id, memeId);
	return { author, voter, mod, memeId, comment };
}

const vote = (pid: string, session: string, body: unknown = { value: 1 }) =>
	callRoute({
		handler: POST,
		path: `/api/comments/${pid}/vote`,
		method: 'POST',
		params: { pid },
		body,
		session
	});

describe('POST /api/comments/[pid]/vote', () => {
	it('votes and clears by public id', async () => {
		const { voter, comment } = await world();
		let { response } = await vote(comment.publicId, voter.session);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ score: 1, userVote: 1 });
		({ response } = await vote(comment.publicId, voter.session, { value: 0 }));
		expect(await response.json()).toEqual({ score: 0, userVote: 0 });
	});

	it('answers 404 for the internal id, junk and unknown ids', async () => {
		const { voter, comment } = await world();
		for (const pid of [String(comment.id), 'abc', 'AAAAAAAAAAAA']) {
			expect((await vote(pid, voter.session)).response.status, pid).toBe(404);
		}
	});

	it('answers 400 for a bad value or body', async () => {
		const { voter, comment } = await world();
		expect((await vote(comment.publicId, voter.session, { value: 2 })).response.status).toBe(400);
		expect((await vote(comment.publicId, voter.session, {})).response.status).toBe(400);
	});

	it('answers 403 for the own comment', async () => {
		const { author, comment } = await world();
		expect((await vote(comment.publicId, author.session)).response.status).toBe(403);
	});

	it('answers 404 to members for a comment under review; moderators may vote', async () => {
		const { author, voter, mod, comment } = await world();
		await addOpenReports('comment', comment.id, author.user.id, OVER_THRESHOLD);
		expect((await vote(comment.publicId, voter.session)).response.status).toBe(404);
		const { response } = await vote(comment.publicId, mod.session);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ score: 1, userVote: 1 });
	});

	it('answers 404 to members for a comment on a meme under review; moderators may vote', async () => {
		const { author, voter, mod, memeId, comment } = await world();
		await addOpenReports('meme', memeId, author.user.id, OVER_THRESHOLD);
		expect((await vote(comment.publicId, voter.session)).response.status).toBe(404);
		expect((await vote(comment.publicId, mod.session)).response.status).toBe(200);
	});

	it('answers 403 for a timed-out member', async () => {
		const { voter, mod, comment } = await world();
		await timeOut(voter.user.id, mod.user.id);
		expect((await vote(comment.publicId, voter.session)).response.status).toBe(403);
	});
});
