import { isHttpError } from '@sveltejs/kit';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import {
	addOpenReports,
	insertCommentRow,
	insertMemeRow,
	OVER_THRESHOLD,
	userWithSession
} from '../../../lib/server/moderation-test-utils';
import { load } from './+page.server';

beforeAll(setupDb);
beforeEach(resetDb);

type Loaded = Awaited<ReturnType<typeof load>> & {
	item: { id: string; uploaderId: string | null; title: string };
	comments: { id: string; mediaId: string; authorId: string }[];
	viewer: { id: string; canModerate: boolean };
	flags: { nsfw: boolean; spoiler: boolean } | null;
};

const run = (pid: string, user: Awaited<ReturnType<typeof userWithSession>>['user']) =>
	load({ params: { pid }, locals: { user } } as never) as Promise<Loaded>;

async function world() {
	const [author, viewer, mod] = await Promise.all([
		userWithSession(),
		userWithSession(),
		userWithSession('moderator')
	]);
	const meme = await insertMemeRow(author.user.id, 'Detail');
	const comment = await insertCommentRow(viewer.user.id, meme.id, 'hallo');
	return { author, viewer, mod, meme, comment };
}

describe('/meme/[pid] load', () => {
	it('loads the meme by public id with public ids in the whole payload', async () => {
		const w = await world();
		const data = await run(w.meme.publicId, w.viewer.user);
		expect(data.item).toMatchObject({
			id: w.meme.publicId,
			uploaderId: w.author.publicId,
			title: 'Detail'
		});
		expect(data.comments).toMatchObject([
			{ id: w.comment.publicId, mediaId: w.meme.publicId, authorId: w.viewer.publicId }
		]);
		expect(data.viewer).toEqual({ id: w.viewer.publicId, canModerate: false });
		expect(data.flags).toBeNull();

		const json = JSON.stringify(data);
		expect(json).not.toMatch(new RegExp(`"(id|mediaId)":${w.meme.id}[,}]`));
		expect(json).not.toMatch(new RegExp(`"(uploaderId|authorId|id)":${w.author.user.id}[,}]`));
		expect(json).not.toMatch(new RegExp(`"(authorId|id)":${w.viewer.user.id}[,}]`));
		expect(json).not.toMatch(new RegExp(`"id":${w.comment.id}[,}]`));
	});

	it('gives the uploader and moderators the manage flags, nobody else', async () => {
		const w = await world();
		expect((await run(w.meme.publicId, w.author.user)).flags).toEqual({
			nsfw: false,
			spoiler: false
		});
		expect((await run(w.meme.publicId, w.mod.user)).flags).toEqual({ nsfw: false, spoiler: false });
		expect((await run(w.meme.publicId, w.viewer.user)).flags).toBeNull();
	});

	it('keeps an under-review meme masked for members, revealed for moderators', async () => {
		const w = await world();
		await addOpenReports('meme', w.meme.id, w.author.user.id, OVER_THRESHOLD);
		const asMember = await run(w.meme.publicId, w.viewer.user);
		expect(asMember.item).toMatchObject({ title: '', uploaderId: null });
		expect((await run(w.meme.publicId, w.mod.user)).item.title).toBe('Detail');
	});

	it.each(['1', '0', 'abc', 'AAAAAAAAAAA', 'AAAAAAAAAAAAA', 'AAAAAA-AAAAA', 'AAAAAAAAAAAA'])(
		'404s "Meme not found" for %s',
		async (pid) => {
			const w = await world();
			const err = await run(pid, w.viewer.user).catch((e: unknown) => e);
			expect(isHttpError(err, 404)).toBe(true);
			expect((err as { body: { message: string } }).body.message).toBe('Meme not found');
		}
	);

	it('404s for the internal numeric id of a real meme', async () => {
		const w = await world();
		const err = await run(String(w.meme.id), w.viewer.user).catch((e: unknown) => e);
		expect(isHttpError(err, 404)).toBe(true);
	});
});
