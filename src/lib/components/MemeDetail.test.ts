import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { CommentItem } from '../server/comments';
import type { FeedItem } from '../server/feed';
import MemeDetail from './MemeDetail.svelte';

// `page` reads a SvelteKit render context that a bare component render does not have.
const pageState = vi.hoisted(() => ({ state: {} as { feedIds?: unknown[] } }));
vi.mock('$app/state', () => ({ page: pageState }));

const MEME = 'MemeAbc12345';
const UPLOADER = 'Up1oad3rXy9Z';
const COMMENT = 'Cmt0Abc12345';
const AUTHOR5 = 'AuthorFiveXX';
const AUTHOR6 = 'AuthorSixYYY';
const VIEWER = 'ViewerNine99';

/** The first `<a>` element linking to `href`, or null. */
function linkTo(html: string, href: string): RegExpMatchArray | null {
	return html.match(new RegExp(`<a\\b[^>]*href="${href}"[^>]*>[\\s\\S]*?</a>`));
}

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
	return {
		id: MEME,
		title: 'Montag',
		kind: 'image',
		thumbUrl: '/media/memes/1/thumb.webp',
		mediaUrl: '/media/memes/1/orig.jpg',
		width: 640,
		height: 480,
		tags: [],
		score: 3,
		userVote: 0,
		commentCount: 1,
		favoriteCount: 0,
		userFavorite: false,
		viewCount: 0,
		blurred: null,
		uploader: 'Hanna Lee',
		uploaderId: UPLOADER,
		uploaderRole: 'member',
		uploaderAvatar: null,
		mine: false,
		createdAt: new Date().toISOString(),
		underReview: false,
		awardMonth: null,
		...overrides
	};
}

function comment(overrides: Partial<CommentItem> = {}): CommentItem {
	return {
		id: COMMENT,
		mediaId: MEME,
		parentId: null,
		replyToId: null,
		depth: 1,
		deleted: false,
		authorId: AUTHOR5,
		author: 'Mo Derator',
		authorRole: 'member',
		authorAvatar: null,
		text: 'Nice one',
		mentions: {},
		score: 0,
		userVote: 0,
		underReview: false,
		createdAt: new Date().toISOString(),
		...overrides
	};
}

function html(item: FeedItem, comments: CommentItem[]): string {
	return render(MemeDetail, {
		props: { item, comments, viewer: { id: VIEWER, canModerate: false }, flags: null }
	}).body;
}

describe('MemeDetail comment authors', () => {
	it('badges a moderator author', () => {
		const body = html(feedItem(), [comment({ authorRole: 'moderator' })]);
		expect(body).toContain('aria-label="Moderator"');
	});

	it('badges an admin author', () => {
		const body = html(feedItem(), [comment({ authorRole: 'admin' })]);
		expect(body).toContain('aria-label="Admin"');
	});

	it('shows no badge for a member author', () => {
		const body = html(feedItem(), [comment()]);
		expect(body).not.toContain('aria-label="Moderator"');
		expect(body).not.toContain('aria-label="Admin"');
	});

	it('shows the author name and an avatar', () => {
		const body = html(feedItem(), [comment({ authorAvatar: 'avatars/u5/abc-64.webp' })]);
		expect(body).toMatch(new RegExp(`<a\\b[^>]*href="/users/${AUTHOR5}"[^>]*>Mo Derator</a>`));
		expect(body).toMatch(/<img class="avatar[^"]*" src="\/media\/avatars\/u5\/abc-64\.webp"/);
	});
});

describe('MemeDetail uploader line', () => {
	it('shows name, avatar and badge', () => {
		const body = html(feedItem({ uploaderRole: 'admin' }), []);
		expect(body).toMatch(/class="by[^"]*">by /);
		expect(body).toMatch(/class="name[^"]*"[^>]*>Hanna Lee<\/a>/);
		expect(body).toContain('aria-label="Admin"');
	});

	it('renders no uploader group for hidden items', () => {
		const body = html(feedItem({ uploader: '', uploaderId: null, underReview: true }), []);
		expect(body).not.toContain('class="by');
	});
});

describe('MemeDetail name links', () => {
	it('links the uploader name to the member page', () => {
		const body = html(feedItem({ uploaderRole: 'moderator' }), []);
		const link = linkTo(body, `/users/${UPLOADER}`);
		expect(link, 'uploader link rendered').not.toBeNull();
		expect(link![0]).toMatch(/class="name[^"]*"/);
		expect(link![0]).toContain('>Hanna Lee</a>');
		expect(link![0]).not.toContain('role="img"');
		expect(body).toContain('aria-label="Moderator"');
	});

	it('renders a plain uploader name when the id is withheld', () => {
		const body = html(feedItem({ uploaderId: null }), []);
		expect(body).toMatch(/<span class="name[^"]*">Hanna Lee<\/span>/);
		expect(body).not.toContain('href="/users/');
	});

	it('links each comment author to /users/<authorId>, badge outside the link', () => {
		const body = html(feedItem(), [
			comment({
				id: 'Cmt1Abc12345',
				authorId: AUTHOR5,
				author: 'Mo Derator',
				authorRole: 'moderator'
			}),
			comment({ id: 'Cmt2Abc12345', authorId: AUTHOR6, author: 'Jonas' })
		]);
		const first = linkTo(body, `/users/${AUTHOR5}`);
		expect(first![0]).toContain('>Mo Derator</a>');
		expect(first![0]).not.toContain('role="img"');
		expect(body).toMatch(new RegExp(`<a\\b[^>]*href="/users/${AUTHOR6}"[^>]*>Jonas</a>`));
	});
});

describe('MemeDetail own comments', () => {
	const reports = (body: string) => body.match(/aria-label="Report"/g)?.length ?? 0;

	it('offers delete but no report on a comment whose authorId is the viewer public id', () => {
		// mine: true keeps the meme's own report control out of the count
		const body = html(feedItem({ mine: true }), [
			comment({ id: 'Cmt1Abc12345', authorId: VIEWER, author: 'Me Myself' })
		]);
		expect(body).toContain('aria-label="Delete comment by Me Myself"');
		expect(reports(body)).toBe(0);
	});

	it('offers report but no delete on a foreign comment', () => {
		const body = html(feedItem({ mine: true }), [comment({ author: 'Mo Derator' })]);
		expect(body).not.toContain('aria-label="Delete comment by Mo Derator"');
		expect(reports(body)).toBe(1);
	});
});

describe('MemeDetail award badge', () => {
	it('shows the badge in the header under the title and uploader line', () => {
		const body = html(feedItem({ awardMonth: '2026-10' }), []);
		expect(body).toContain('Meme of the Month · Oct 2026');
		expect(body).toContain('aria-label="Meme of the Month, October 2026"');
		expect(body.indexOf('Meme of the Month ·')).toBeGreaterThan(body.indexOf('<h1>'));
	});

	it('shows no badge without an award', () => {
		expect(html(feedItem(), [])).not.toContain('Meme of the Month');
	});
});

describe('MemeDetail swipe navigation', () => {
	const NEIGHBOUR = 'Neighb0ur123';
	const tag = (body: string, label: string) =>
		body.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';

	it('offers both neighbours for public ids in the history state', () => {
		pageState.state = { feedIds: [NEIGHBOUR, MEME, 'Neighb0ur456'] };
		const body = html(feedItem(), []);
		expect(tag(body, 'Previous meme')).not.toContain('disabled');
		expect(tag(body, 'Next meme')).not.toContain('disabled');
		pageState.state = {};
	});

	it('ignores forged entries that are not public ids', () => {
		// numbers, short strings and injection attempts: dropped, so the current meme has no neighbours
		pageState.state = { feedIds: [1, '2', 'x', "'; DROP TABLE media;--", MEME, 12345678901234] };
		const body = html(feedItem(), []);
		expect(tag(body, 'Previous meme')).toContain('disabled');
		expect(tag(body, 'Next meme')).toContain('disabled');
		pageState.state = {};
	});

	it('shows no pager when nothing valid is left', () => {
		pageState.state = { feedIds: [1, 'bad', null] };
		const body = html(feedItem(), []);
		expect(body).not.toContain('aria-label="Next meme"');
		pageState.state = {};
	});
});

describe('MemeDetail remix link', () => {
	it('links an image meme to the generator', () => {
		const body = html(feedItem(), []);
		const link = linkTo(body, `/create\\?meme=${MEME}`);
		expect(link, 'remix link rendered').not.toBeNull();
		expect(link![0]).toContain('Remix');
	});

	it('is absent for a gif and a video', () => {
		expect(html(feedItem({ kind: 'gif' }), [])).not.toContain('/create?meme=');
		expect(html(feedItem({ kind: 'video' }), [])).not.toContain('/create?meme=');
	});

	it('is absent when the meme is withheld from the viewer', () => {
		const body = html(feedItem({ mediaUrl: null, underReview: true }), []);
		expect(body).not.toContain('/create?meme=');
	});
});
