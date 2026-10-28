import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { templates } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import {
	insertComment,
	insertCommentRow,
	insertMeme,
	insertMemeRow,
	insertQuote,
	insertQuoteRow,
	userWithSession
} from './moderation-test-utils';
import {
	isPublicId,
	PUBLIC_ID_RE,
	publicIdOfMedia,
	publicIdOfUser,
	resolveCommentId,
	resolveMediaId,
	resolveQuoteId,
	resolveTemplateId,
	resolveUserId
} from './public-ids';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const UNKNOWN = 'AAAAAAAAAAAA';

const insertTemplate = async () => {
	const [row] = await db
		.insert(templates)
		.values({ name: 'T', objectKey: 'k', thumbKey: 'kt', width: 1, height: 1 })
		.returning();
	return row;
};

describe('public_id() generator', () => {
	it('yields 10 000 distinct 12-character alphanumeric ids', async () => {
		const rows = await db.execute<{ pid: string }>(
			sql`SELECT public_id() AS pid FROM generate_series(1, 10000)`
		);
		const ids = rows.map((r) => r.pid);
		expect(ids).toHaveLength(10_000);
		for (const id of ids) expect(id).toMatch(PUBLIC_ID_RE);
		expect(new Set(ids).size).toBe(10_000);
	});
});

describe('isPublicId', () => {
	it.each([
		['AbCdEfGhIjKl', true],
		['012345678901', true],
		['zzzzzzzzzzzz', true],
		['AbCdEfGhIjK', false], // 11 characters
		['AbCdEfGhIjKlM', false], // 13 characters
		['AbCdEfGhIj-l', false],
		['AbCdEfGhIj_l', false],
		['AbCdEfGhIj l', false],
		['AbCdEfGhIjKl\n', false], // a trailing newline must not slip past `$`
		['12', false],
		['', false]
	])('%j -> %s', (input, expected) => {
		expect(isPublicId(input)).toBe(expected);
	});

	it('rejects non-strings', () => {
		for (const v of [null, undefined, 123456789012, {}, ['AbCdEfGhIjKl']]) {
			expect(isPublicId(v)).toBe(false);
		}
	});
});

describe('new rows get a public id', () => {
	it('on users, media, comments, quotes and templates', async () => {
		const user = await testUser();
		const meme = await insertMemeRow(user.id);
		const comment = await insertCommentRow(user.id, meme.id);
		const quote = await insertQuoteRow(user.id);
		const tpl = await insertTemplate();
		const all = [user.publicId, meme.publicId, comment.publicId, quote.publicId, tpl.publicId];
		for (const pid of all) expect(pid).toMatch(PUBLIC_ID_RE);
		expect(new Set(all).size).toBe(all.length);
	});

	it('gives every row of a table its own id', async () => {
		await testUser();
		await testUser();
		await testUser();
		const rows = await db.execute<{ n: number; d: number }>(
			sql`SELECT count(*)::int AS n, count(DISTINCT public_id)::int AS d FROM users`
		);
		expect(rows[0]).toEqual({ n: 3, d: 3 });
	});
});

describe('test helpers', () => {
	it('userWithSession exposes the public id, on the session user and next to it', async () => {
		const { user, publicId } = await userWithSession('moderator');
		expect(publicId).toMatch(PUBLIC_ID_RE);
		expect(await resolveUserId(publicId)).toBe(user.id);
		expect(user.publicId).toBe(publicId);
	});

	it('insertMeme, insertComment and insertQuote keep returning the numeric id', async () => {
		const u = await testUser();
		const m = await insertMeme(u.id);
		expect(typeof m).toBe('number');
		expect(typeof (await insertComment(u.id, m))).toBe('number');
		expect(typeof (await insertQuote(u.id))).toBe('number');
	});
});

describe('resolvers', () => {
	it('map a real public id to the internal id', async () => {
		const user = await testUser();
		const meme = await insertMemeRow(user.id);
		const comment = await insertCommentRow(user.id, meme.id);
		const quote = await insertQuoteRow(user.id);
		const tpl = await insertTemplate();
		expect(await resolveUserId(user.publicId)).toBe(user.id);
		expect(await resolveMediaId(meme.publicId)).toBe(meme.id);
		expect(await resolveCommentId(comment.publicId)).toBe(comment.id);
		expect(await resolveQuoteId(quote.publicId)).toBe(quote.id);
		expect(await resolveTemplateId(tpl.publicId)).toBe(tpl.id);
	});

	it('answer null for an unknown id', async () => {
		for (const resolve of [
			resolveMediaId,
			resolveUserId,
			resolveCommentId,
			resolveQuoteId,
			resolveTemplateId
		]) {
			expect(await resolve(UNKNOWN)).toBeNull();
		}
	});

	it('answer null for an invalid shape, including numeric ids', async () => {
		const user = await testUser();
		const meme = await insertMemeRow(user.id);
		const bad = [String(meme.id), String(user.id), '', 'short', `${meme.publicId}x`, '../etc'];
		for (const b of bad) {
			expect(await resolveMediaId(b)).toBeNull();
			expect(await resolveUserId(b)).toBeNull();
		}
	});

	it('do not mix tables', async () => {
		const user = await testUser();
		const meme = await insertMemeRow(user.id);
		expect(await resolveUserId(meme.publicId)).toBeNull();
		expect(await resolveMediaId(user.publicId)).toBeNull();
	});
});

describe('publicIdOf*', () => {
	it('returns the public id of an internal id and null when missing', async () => {
		const user = await testUser();
		const meme = await insertMemeRow(user.id);
		expect(await publicIdOfUser(user.id)).toBe(user.publicId);
		expect(await publicIdOfMedia(meme.id)).toBe(meme.publicId);
		expect(await publicIdOfUser(999_999)).toBeNull();
		expect(await publicIdOfMedia(999_999)).toBeNull();
	});
});
