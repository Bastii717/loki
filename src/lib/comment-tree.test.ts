import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyVote,
	buildCommentTree,
	commentIdFromHash,
	countReplies,
	readSort,
	removeComment,
	SORT_KEY,
	writeSort,
	type CommentNode
} from './comment-tree';
import type { CommentItem } from './server/comments';

let seq = 0;
function c(id: string, overrides: Partial<CommentItem> = {}): CommentItem {
	seq += 1;
	return {
		id,
		mediaId: 'MemeAbc12345',
		parentId: null,
		replyToId: null,
		depth: 1,
		deleted: false,
		authorId: 'AuthorFiveXX',
		author: 'Mo',
		authorRole: 'member',
		authorAvatar: null,
		text: `text ${id}`,
		mentions: {},
		score: 0,
		userVote: 0,
		underReview: false,
		createdAt: new Date(Date.UTC(2026, 10, 9, 12, 0, seq)).toISOString(),
		editedAt: null,
		...overrides
	};
}
const reply = (id: string, parent: string, depth: 2 | 3, o: Partial<CommentItem> = {}) =>
	c(id, { parentId: parent, replyToId: parent, depth, ...o });

const ids = (nodes: CommentNode[]) => nodes.map((n) => n.item.id);

describe('buildCommentTree', () => {
	const items = [
		c('a', { score: 1 }),
		c('b', { score: 5 }),
		reply('b1', 'b', 2, { score: 9 }),
		c('c', { score: 5 }),
		reply('b2', 'b', 2, { score: -3 }),
		reply('b1x', 'b1', 3),
		reply('b1y', 'b1', 3, { replyToId: 'b1x', score: 4 }),
		c('d', { score: -1 })
	];

	it('New puts the newest top-level comment first', () => {
		expect(ids(buildCommentTree(items, 'new'))).toEqual(['d', 'c', 'b', 'a']);
	});

	it('Top orders by score, ties newest first', () => {
		expect(ids(buildCommentTree(items, 'top'))).toEqual(['c', 'b', 'a', 'd']);
	});

	it('keeps replies oldest first whatever the sort', () => {
		for (const sort of ['top', 'new'] as const) {
			const b = buildCommentTree(items, sort).find((n) => n.item.id === 'b')!;
			expect(ids(b.replies)).toEqual(['b1', 'b2']);
			expect(ids(b.replies[0].replies)).toEqual(['b1x', 'b1y']);
		}
	});

	it('puts pinned ids first in Top, newest first', () => {
		const tree = buildCommentTree(items, 'top', new Set(['d', 'a']));
		expect(ids(tree)).toEqual(['d', 'a', 'c', 'b']);
	});

	it('ignores pinned ids in New', () => {
		expect(ids(buildCommentTree(items, 'new', new Set(['a'])))).toEqual(['d', 'c', 'b', 'a']);
	});

	it('keeps tombstones in place with their replies', () => {
		const withTomb = [
			c('a', { score: 2 }),
			c('t', { deleted: true, author: '', authorId: '', text: null }),
			reply('t1', 't', 2),
			c('z')
		];
		expect(ids(buildCommentTree(withTomb, 'new'))).toEqual(['z', 't', 'a']);
		const top = buildCommentTree(withTomb, 'top');
		expect(ids(top)).toEqual(['a', 'z', 't']);
		expect(ids(top[2].replies)).toEqual(['t1']);
	});

	it('shows a reply whose parent is missing at the top level instead of dropping it', () => {
		expect(ids(buildCommentTree([c('a'), reply('x', 'gone', 2)], 'new'))).toEqual(['x', 'a']);
	});
});

describe('applyVote', () => {
	it('patches the shared item, so a built tree shows the score but keeps its order', () => {
		const list = [c('a', { score: 2 }), c('b', { score: 1 })];
		const tree = buildCommentTree(list, 'top');
		applyVote(list, 'b', { score: 3, userVote: 1 });
		expect(ids(tree)).toEqual(['a', 'b']);
		expect(tree[1].item).toMatchObject({ score: 3, userVote: 1 });
		// the next rebuild sorts by the live score, matching what is shown
		expect(ids(buildCommentTree(list, 'top'))).toEqual(['b', 'a']);
	});

	it('ignores an unknown id', () => {
		const list = [c('a', { score: 2 })];
		applyVote(list, 'nope', { score: 9, userVote: 1 });
		expect(list[0]).toMatchObject({ score: 2, userVote: 0 });
	});
});

describe('countReplies', () => {
	it('counts live replies at any depth, not tombstones', () => {
		const tomb = { deleted: true, text: null, author: '', authorId: '' };
		const tree = buildCommentTree(
			[
				c('a'),
				reply('a1', 'a', 2, tomb),
				reply('a1x', 'a1', 3),
				reply('a1y', 'a1', 3),
				reply('a2', 'a', 2)
			],
			'new'
		);
		expect(countReplies(tree[0])).toBe(3);
	});

	it('is 0 when only tombstones are left under a node', () => {
		const tomb = { deleted: true, text: null, author: '', authorId: '' };
		const tree = buildCommentTree([c('a'), reply('a1', 'a', 2, tomb)], 'new');
		expect(countReplies(tree[0])).toBe(0);
	});
});

describe('commentIdFromHash', () => {
	it('reads a #c-<public id> deep link', () => {
		expect(commentIdFromHash('#c-Cmt0Abc12345')).toBe('Cmt0Abc12345');
	});

	it('ignores other hashes', () => {
		for (const h of ['', '#comments', '#c-short', '#c-Cmt0Abc12345x', '#c-Cmt0Abc1234!']) {
			expect(commentIdFromHash(h)).toBeNull();
		}
	});
});

describe('removeComment', () => {
	it('removes a comment without replies', () => {
		const out = removeComment([c('a'), c('b')], 'a');
		expect(out.map((x) => x.id)).toEqual(['b']);
	});

	it('turns a comment with replies into a tombstone in place', () => {
		const out = removeComment(
			[c('a', { score: 3, editedAt: '2026-11-09T12:02:00.000Z' }), reply('a1', 'a', 2), c('b')],
			'a'
		);
		expect(out.map((x) => x.id)).toEqual(['a', 'a1', 'b']);
		expect(out[0]).toMatchObject({
			deleted: true,
			text: null,
			author: '',
			authorId: '',
			authorAvatar: null,
			mentions: {},
			userVote: 0,
			underReview: false,
			editedAt: null
		});
		// the sort position stays until the next load
		expect(buildCommentTree(out, 'top').map((n) => n.item.id)).toEqual(['a', 'b']);
	});

	it('counts a level-3 sibling that answered it as a reply', () => {
		const items = [c('a'), reply('a1', 'a', 2), reply('x', 'a1', 3), reply('y', 'a1', 3)];
		items[3].replyToId = 'x';
		const out = removeComment(items, 'x');
		expect(out.find((i) => i.id === 'x')?.deleted).toBe(true);
	});

	it('removes tombstone ancestors left without replies', () => {
		const items = [
			c('t', { deleted: true, text: null }),
			reply('t1', 't', 2, { deleted: true, text: null }),
			reply('leaf', 't1', 3),
			c('b')
		];
		expect(removeComment(items, 'leaf').map((x) => x.id)).toEqual(['b']);
	});

	it('keeps a tombstone that still has other replies', () => {
		const items = [c('t', { deleted: true, text: null }), reply('t1', 't', 2), reply('t2', 't', 2)];
		expect(removeComment(items, 't1').map((x) => x.id)).toEqual(['t', 't2']);
	});

	it('returns the list unchanged for an unknown id', () => {
		const items = [c('a')];
		expect(removeComment(items, 'nope')).toBe(items);
	});
});

describe('sort preference', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('defaults to top without storage', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(readSort()).toBe('top');
	});

	it('defaults to top when storage throws', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		});
		expect(readSort()).toBe('top');
		expect(() => writeSort('new')).not.toThrow();
	});

	it('round-trips through loki.commentSort and ignores junk', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v)
		});
		expect(SORT_KEY).toBe('loki.commentSort');
		writeSort('new');
		expect(store.get('loki.commentSort')).toBe('new');
		expect(readSort()).toBe('new');
		store.set('loki.commentSort', 'hot');
		expect(readSort()).toBe('top');
	});
});
