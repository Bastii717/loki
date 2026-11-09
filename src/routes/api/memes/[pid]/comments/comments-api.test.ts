import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../../../../lib/server/db/test-utils';
import {
	insertCommentRow,
	insertMemeRow,
	userWithSession
} from '../../../../../lib/server/moderation-test-utils';
import { mentionToken } from '../../../../../lib/mentions';
import { resetRateLimits } from '../../../../../lib/server/rate-limit';
import { callRoute } from '../../../../../lib/server/test-request';
import { DELETE as deleteComment } from '../../../comments/[pid]/+server';
import { GET, POST } from './+server';

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	await resetDb();
});

interface Comment {
	id: string;
	mediaId: string;
	authorId: string;
	text: string | null;
}

async function world() {
	const [author, viewer] = await Promise.all([userWithSession(), userWithSession()]);
	const meme = await insertMemeRow(author.user.id);
	return { author, viewer, meme };
}

describe('comments by public id', () => {
	it('lists comments with public ids and no internal id', async () => {
		const w = await world();
		const c = await insertCommentRow(w.author.user.id, w.meme.id, 'erster');
		const { response } = await callRoute({
			handler: GET,
			path: `/api/memes/${w.meme.publicId}/comments`,
			params: { pid: w.meme.publicId },
			session: w.viewer.session
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { comments: Comment[] };
		expect(body.comments).toMatchObject([
			{ id: c.publicId, mediaId: w.meme.publicId, authorId: w.author.publicId, text: 'erster' }
		]);
		const json = JSON.stringify(body);
		expect(json).not.toMatch(new RegExp(`"id":${c.id}[,}]`));
		expect(json).not.toMatch(new RegExp(`"mediaId":${w.meme.id}[,}]`));
		expect(json).not.toMatch(new RegExp(`"authorId":${w.author.user.id}[,}]`));
	});

	it('creates a comment (201) whose public id deletes it again', async () => {
		const w = await world();
		const created = await callRoute({
			handler: POST,
			path: `/api/memes/${w.meme.publicId}/comments`,
			method: 'POST',
			params: { pid: w.meme.publicId },
			body: { text: 'neu' },
			session: w.viewer.session
		});
		expect(created.response.status).toBe(201);
		const item = (await created.response.json()) as Comment;
		expect(item).toMatchObject({
			mediaId: w.meme.publicId,
			authorId: w.viewer.publicId,
			text: 'neu'
		});

		const removed = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${item.id}`,
			method: 'DELETE',
			params: { pid: item.id },
			session: w.viewer.session
		});
		expect(removed.response.status).toBe(204);

		const list = await callRoute({
			handler: GET,
			path: `/api/memes/${w.meme.publicId}/comments`,
			params: { pid: w.meme.publicId },
			session: w.viewer.session
		});
		expect(((await list.response.json()) as { comments: Comment[] }).comments).toEqual([]);
	});

	it('creates a reply by public id; unknown replyTo is 404; 6 mentions are 400', async () => {
		const w = await world();
		const c = await insertCommentRow(w.author.user.id, w.meme.id, 'root');
		const post = (body: object) =>
			callRoute({
				handler: POST,
				path: `/api/memes/${w.meme.publicId}/comments`,
				method: 'POST',
				params: { pid: w.meme.publicId },
				body,
				session: w.viewer.session
			});
		const ok = await post({ text: 're', replyTo: c.publicId });
		expect(ok.response.status).toBe(201);
		expect(await ok.response.json()).toMatchObject({ parentId: c.publicId, depth: 2 });
		expect((await post({ text: 're', replyTo: 'aaaaaaaaaaaa' })).response.status).toBe(404);
		const six = [
			'aaaaaaaaaaa1',
			'aaaaaaaaaaa2',
			'aaaaaaaaaaa3',
			'aaaaaaaaaaa4',
			'aaaaaaaaaaa5',
			'aaaaaaaaaaa6'
		]
			.map((id) => mentionToken(id))
			.join(' ');
		expect((await post({ text: six })).response.status).toBe(400);
	});

	it('answers 404 when deleting with the numeric id of a real comment', async () => {
		const w = await world();
		const c = await insertCommentRow(w.viewer.user.id, w.meme.id, 'bleibt');
		const { response } = await callRoute({
			handler: deleteComment,
			path: `/api/comments/${c.id}`,
			method: 'DELETE',
			params: { pid: String(c.id) },
			session: w.viewer.session
		});
		expect(response.status).toBe(404);
	});
});
