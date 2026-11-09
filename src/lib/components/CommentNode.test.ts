import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { CommentNode as TreeNode, CommentSection } from '../comment-tree';
import type { CommentItem } from '../server/comments';
import CommentNode from './CommentNode.svelte';

const MEME = 'MemeAbc12345';
const COMMENT = 'Cmt0Abc12345';
const AUTHOR = 'AuthorFiveXX';
const VIEWER = 'ViewerNine99';
const LENA = 'LenaKowal123';

function comment(overrides: Partial<CommentItem> = {}): CommentItem {
	return {
		id: COMMENT,
		mediaId: MEME,
		parentId: null,
		replyToId: null,
		depth: 1,
		deleted: false,
		authorId: AUTHOR,
		author: 'Mo Derator',
		authorRole: 'member',
		authorAvatar: null,
		text: 'Nice one',
		mentions: {},
		score: 3,
		userVote: 0,
		underReview: false,
		createdAt: new Date().toISOString(),
		editedAt: null,
		...overrides
	};
}

const tombstone = (overrides: Partial<CommentItem> = {}) =>
	comment({
		deleted: true,
		authorId: '',
		author: '',
		text: null,
		score: 0,
		...overrides
	});

function section(overrides: Partial<CommentSection> = {}): CommentSection {
	return {
		mediaId: MEME,
		viewer: { id: VIEWER, canModerate: false },
		locked: false,
		lockTitle: undefined,
		replyingTo: null,
		editing: null,
		highlighted: null,
		blocked: () => false,
		openReply: () => {},
		openEdit: () => {},
		posted: () => {},
		edited: () => {},
		deleted: () => {},
		...overrides
	};
}

const node = (item: CommentItem, replies: TreeNode[] = []): TreeNode => ({ item, replies });

function html(n: TreeNode, s: Partial<CommentSection> = {}): string {
	return render(CommentNode, { props: { node: n, section: section(s) } }).body;
}

const button = (body: string, label: string) =>
	body.match(new RegExp(`<button\\b[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? null;

describe('CommentNode', () => {
	it('anchors the node as c-<pid>', () => {
		expect(html(node(comment()))).toMatch(new RegExp(`<li\\b[^>]*id="c-${COMMENT}"`));
	});

	it('links the author like the meme page does', () => {
		const body = html(node(comment()));
		expect(body).toMatch(new RegExp(`<a\\b[^>]*href="/users/${AUTHOR}"[^>]*>Mo Derator</a>`));
	});

	it('renders a mention as a link to the member page with the current name', () => {
		const body = html(
			node(comment({ text: `hey @[u:${LENA}]!`, mentions: { [LENA]: 'Lena K.' } }))
		);
		expect(body).toMatch(new RegExp(`<a\\b[^>]*href="/users/${LENA}"[^>]*>@Lena K\\.</a>`));
		expect(body).not.toContain('@[u:');
		// no stray whitespace around the parts (the text is white-space: pre-wrap)
		const bare = body.replace(/<!--[\s\S]*?-->/g, '');
		expect(bare).toMatch(/<p class="text[^"]*">hey <a\b[^>]*>@Lena K\.<\/a>!<\/p>/);
	});

	it('renders an unknown mention as plain text', () => {
		const body = html(node(comment({ text: `hey @[u:${LENA}]` })));
		expect(body).toContain('@unknown member');
		expect(body).not.toContain(`/users/${LENA}`);
		expect(body).not.toContain('@[u:');
	});

	it('shows vote arrows and the score on a foreign comment', () => {
		const body = html(node(comment({ userVote: 1 })));
		expect(button(body, 'Upvote comment by Mo Derator')).toContain('aria-pressed="true"');
		expect(button(body, 'Downvote comment by Mo Derator')).toContain('aria-pressed="false"');
		expect(body).toContain('+3');
	});

	it('renders no vote arrows on an own comment, but its score', () => {
		const body = html(node(comment({ authorId: VIEWER })));
		expect(body).not.toContain('Upvote');
		expect(body).not.toContain('Downvote');
		expect(body).toMatch(/<b class="score[^"]*">[\s\S]*?\+3<\/b>/);
		expect(body).toContain('aria-label="Delete comment by Mo Derator"');
		expect(body).not.toContain('aria-label="Report"');
	});

	it('offers reply and report on a foreign comment, delete only to moderators', () => {
		const member = html(node(comment()));
		expect(button(member, 'Reply to Mo Derator')).not.toBeNull();
		expect(member).toContain('aria-label="Report"');
		expect(member).not.toContain('Delete comment');
		const mod = html(node(comment()), { viewer: { id: VIEWER, canModerate: true } });
		expect(mod).toContain('aria-label="Delete comment by Mo Derator"');
	});

	it('renders a tombstone as [deleted] without vote, reply, report or delete', () => {
		const body = html(node(tombstone(), [node(comment({ id: 'Reply1234567', depth: 2 }))]), {
			viewer: { id: VIEWER, canModerate: true }
		});
		const own = body.slice(0, body.indexOf('Reply1234567'));
		expect(own).toContain('[deleted]');
		expect(own).not.toContain('Upvote');
		expect(own).not.toContain('class="score');
		expect(own).not.toContain('Reply to');
		expect(own).not.toContain('aria-label="Report"');
		expect(own).not.toContain('Delete comment');
		expect(own).not.toContain('/users/');
	});

	it('shows Under review instead of withheld text', () => {
		expect(html(node(comment({ text: null, underReview: true })))).toContain('Under review');
	});

	it('offers no vote arrows on withheld text, but shows the score', () => {
		const body = html(node(comment({ text: null, underReview: true })));
		expect(body).not.toContain('Upvote');
		expect(body).not.toContain('Downvote');
		expect(body).toMatch(/<b class="score[^"]*">[\s\S]*?\+3<\/b>/);
	});

	it('keeps the arrows for a moderator who sees the text under review', () => {
		const body = html(node(comment({ underReview: true })), {
			viewer: { id: VIEWER, canModerate: true }
		});
		expect(button(body, 'Upvote comment by Mo Derator')).not.toBeNull();
	});

	it('nests replies and offers a collapse toggle', () => {
		const body = html(
			node(comment(), [
				node(comment({ id: 'Reply1234567', depth: 2, text: 'first reply' })),
				node(comment({ id: 'Reply7654321', depth: 2, text: 'second reply' }))
			])
		);
		expect(body).toMatch(/<button\b[^>]*aria-expanded="true"[^>]*>[\s\S]*?Hide replies/);
		expect(body.indexOf('first reply')).toBeLessThan(body.indexOf('second reply'));
		expect(body).toMatch(/<ul class="replies/);
	});

	it('offers no collapse toggle without replies', () => {
		expect(html(node(comment()))).not.toContain('Hide replies');
	});

	it('renders depth-3 siblings side by side, without deeper indentation', () => {
		const x = comment({ id: 'Level3xxxxxx', depth: 3, text: 'x' });
		const y = comment({ id: 'Level3yyyyyy', depth: 3, text: 'y', replyToId: 'Level3xxxxxx' });
		const body = html(node(comment({ depth: 2 }), [node(x), node(y)]));
		// one replies list under the level-2 comment; y is not nested inside x
		expect(body.match(/<ul class="replies/g)).toHaveLength(1);
		// a level-3 node never opens an indented list of its own
		const deep = html(node(x, [node(y)]));
		expect(deep).not.toMatch(/<ul class="replies(?![^"]*flat)/);
	});

	it('opens the reply composer under the node it answers', () => {
		const body = html(node(comment()), { replyingTo: COMMENT });
		expect(body).toMatch(/<textarea\b[^>]*role="combobox"/);
		expect(body).toMatch(/<textarea\b[^>]*aria-label="Reply to Mo Derator"/);
	});

	it('pre-fills a mention of the author when replying on level 3', () => {
		const body = html(node(comment({ depth: 3 })), { replyingTo: COMMENT });
		expect(body).toMatch(/<textarea\b[^>]*>@Mo Derator <\/textarea>/);
	});

	it('does not pre-fill on levels 1 and 2', () => {
		const body = html(node(comment({ depth: 2 })), { replyingTo: COMMENT });
		expect(body).toMatch(/<textarea\b[^>]*><\/textarea>/);
	});

	describe('editing', () => {
		const own = (overrides: Partial<CommentItem> = {}) =>
			comment({ authorId: VIEWER, author: 'Vi Ewer', ...overrides });
		const editButton = (body: string) => button(body, 'Edit your comment');

		it('offers Edit on an own fresh comment', () => {
			expect(editButton(html(node(own())))).not.toBeNull();
		});

		it("offers no Edit on someone else's comment, even to moderators", () => {
			expect(editButton(html(node(comment())))).toBeNull();
			expect(
				editButton(html(node(comment()), { viewer: { id: VIEWER, canModerate: true } }))
			).toBeNull();
		});

		it('offers no Edit once the five minutes are over', () => {
			const old = new Date(Date.now() - 6 * 60_000).toISOString();
			expect(editButton(html(node(own({ createdAt: old }))))).toBeNull();
		});

		it('offers no Edit on a tombstone or on withheld text', () => {
			expect(editButton(html(node(tombstone({ authorId: VIEWER }))))).toBeNull();
			expect(editButton(html(node(own({ text: null, underReview: true }))))).toBeNull();
			// a moderator-author still sees their text under review, but may not edit it
			expect(editButton(html(node(own({ underReview: true }))))).toBeNull();
		});

		it('marks an edited comment with the edit time as tooltip', () => {
			const editedAt = '2026-11-09T10:02:00.000Z';
			const body = html(node(comment({ editedAt })));
			expect(body).toMatch(/<span class="edited[^"]*" title="Edited [^"]+">\(edited\)<\/span>/);
			expect(html(node(comment()))).not.toContain('(edited)');
		});

		it('replaces the text with a prefilled Save composer while editing', () => {
			const body = html(node(own({ text: `hi @[u:${LENA}]`, mentions: { [LENA]: 'Lena K.' } })), {
				editing: COMMENT
			});
			expect(body).toMatch(
				/<textarea\b[^>]*aria-label="Edit your comment"[^>]*>hi @Lena K\.<\/textarea>/
			);
			expect(body).toMatch(/<button\b[^>]*type="submit"[^>]*>Save<\/button>/);
			expect(body).not.toMatch(/<p class="text/);
			expect(body).toContain('>Cancel<');
		});
	});
});
