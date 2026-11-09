/** Client-side shaping of a meme's flat comment list into the threaded, sorted view. */
import type { CommentItem } from './server/comments';

export type CommentSort = 'top' | 'new';

/** How long after posting the author may edit a comment (the server enforces it; shared with it). */
export const EDIT_WINDOW_MS = 5 * 60_000;

export interface CommentNode {
	item: CommentItem;
	replies: CommentNode[];
}

/**
 * Nests `items` (oldest first, as the server sends them) by `parentId`. Replies always keep the
 * input order. The top level keeps it for `new`; `top` orders by score (ties: input order) after
 * the `pinned` ids, which the viewer just posted and keep in input order. A reply whose parent is
 * missing is shown at the top level rather than dropped.
 */
export function buildCommentTree(
	items: CommentItem[],
	sort: CommentSort,
	pinned: ReadonlySet<string> = new Set()
): CommentNode[] {
	const byId = new Map<string, CommentNode>();
	for (const item of items) byId.set(item.id, { item, replies: [] });
	const roots: CommentNode[] = [];
	for (const item of items) {
		const node = byId.get(item.id)!;
		const parent = item.parentId === null ? undefined : byId.get(item.parentId);
		if (parent && parent !== node) parent.replies.push(node);
		else roots.push(node);
	}
	if (sort === 'new') return roots;
	const order = new Map(roots.map((n, i) => [n, i]));
	const rank = (n: CommentNode) => (pinned.has(n.item.id) ? 1 : 0);
	return [...roots].sort(
		(a, b) =>
			rank(b) - rank(a) ||
			(rank(a) === 1 ? 0 : b.item.score - a.item.score) ||
			order.get(a)! - order.get(b)!
	);
}

/** Live comments under `node`, at any depth (tombstones are not counted). */
export function countReplies(node: CommentNode): number {
	return node.replies.reduce((n, r) => n + (r.item.deleted ? 0 : 1) + countReplies(r), 0);
}

/** The comment id a `#c-<pid>` deep link points at, or null. */
export function commentIdFromHash(hash: string): string | null {
	return /^#c-([0-9A-Za-z]{12})$/.exec(hash)?.[1] ?? null;
}

/**
 * The blanked form the server sends for a deleted comment that others answered. The score stays
 * (it is never shown on a tombstone) so the tombstone keeps its place under Top until the next load.
 */
export function tombstoneOf(item: CommentItem): CommentItem {
	return {
		...item,
		deleted: true,
		authorId: '',
		author: '',
		authorRole: 'member',
		authorAvatar: null,
		text: null,
		mentions: {},
		userVote: 0,
		underReview: false,
		editedAt: null
	};
}

const answered = (items: CommentItem[], id: string) =>
	items.some((c) => c.id !== id && (c.parentId === id || c.replyToId === id));

/**
 * The list after deleting `id`, mirroring the server: a comment that others answered (as parent or
 * as the answered comment of a level-3 sibling) becomes a tombstone, any other is removed along
 * with the tombstones it leaves without replies.
 */
export function removeComment(items: CommentItem[], id: string): CommentItem[] {
	const target = items.find((c) => c.id === id);
	if (!target) return items;
	if (answered(items, id)) return items.map((c) => (c.id === id ? tombstoneOf(c) : c));
	let out = items.filter((c) => c.id !== id);
	const queue = [target.parentId, target.replyToId];
	while (queue.length > 0) {
		const next = queue.pop();
		if (next == null) continue;
		const t = out.find((c) => c.id === next);
		if (!t?.deleted || answered(out, next)) continue;
		out = out.filter((c) => c.id !== next);
		queue.push(t.parentId, t.replyToId);
	}
	return out;
}

export const SORT_KEY = 'loki.commentSort';

/** The remembered sort, `top` when there is none or storage is blocked. */
export function readSort(): CommentSort {
	try {
		return localStorage.getItem(SORT_KEY) === 'new' ? 'new' : 'top';
	} catch {
		return 'top';
	}
}

export function writeSort(sort: CommentSort): void {
	try {
		localStorage.setItem(SORT_KEY, sort);
	} catch {
		// blocked storage: the choice just lasts for this page view
	}
}

/**
 * What every comment node shares with the comment section (`MemeDetail`). Fields are read live
 * (getters over the section's state).
 */
export interface CommentSection {
	/** Public id of the meme. */
	mediaId: string;
	viewer: { id: string; canModerate: boolean };
	/** Writes are locked (maintenance or timeout); `lockTitle` says why. */
	locked: boolean;
	lockTitle: string | undefined;
	/** Id of the comment whose inline reply composer is open, if any. */
	replyingTo: string | null;
	/** Id of the comment being edited in place, if any (never open together with a reply). */
	editing: string | null;
	/** Id of the comment a `#c-<pid>` deep link points at, while it is highlighted. */
	highlighted: string | null;
	/** Explains the write lock via `show` and returns true while writes are locked. */
	blocked(show: (message: string) => void): boolean;
	/** Opens the inline reply composer under `id`, or closes it with null. */
	openReply(id: string | null): void;
	/** Opens the in-place editor for `id` (closing any reply composer), or closes it with null. */
	openEdit(id: string | null): void;
	/** A comment or reply was created. */
	posted(item: CommentItem): void;
	/** A comment was edited; replaces it in the list. */
	edited(item: CommentItem): void;
	/** A comment was deleted on the server (or was already gone). */
	deleted(id: string): void;
}
