/** @-mentions are stored as `@[u:<public id>]` tokens and rendered as the member's board name. Client-safe. */
export const MAX_MENTIONS = 5;

/**
 * Longest comment the server accepts. It counts the encoded text, where every mention is a
 * 17-character `@[u:…]` token, so a comment with mentions can exceed it while the visible text does not.
 */
export const MAX_COMMENT_LENGTH = 2000;

const TOKEN_RE = /@\[u:([0-9A-Za-z]{12})\]/g;

export const mentionToken = (publicId: string): string => `@[u:${publicId}]`;

/** Distinct mentioned public ids in first-seen order. */
export function mentionIds(text: string): string[] {
	return [...new Set([...text.matchAll(TOKEN_RE)].map((m) => m[1]))];
}

export type MentionPart = { kind: 'text'; text: string } | { kind: 'mention'; id: string };

export function splitMentions(text: string): MentionPart[] {
	const parts: MentionPart[] = [];
	let last = 0;
	for (const m of text.matchAll(TOKEN_RE)) {
		if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
		parts.push({ kind: 'mention', id: m[1] });
		last = m.index + m[0].length;
	}
	if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
	return parts;
}

/** Replaces tokens with `@<name>`; ids missing from `names` become `@unknown member`. */
export function renderMentionsPlain(text: string, names: Record<string, string>): string {
	return text.replace(TOKEN_RE, (_, id: string) => `@${names[id] ?? 'unknown member'}`);
}

/**
 * The editable form of a stored text: tokens of members in `names` become `@<name>` and yield one
 * pick per member; unknown tokens stay raw, which `encodeMentions` leaves untouched, so they survive
 * an edit unchanged. As when posting, a hand-typed plain `@Name` that equals a picked name becomes a
 * token on save too.
 */
export function editableMentions(
	text: string,
	names: Record<string, string>
): { text: string; picks: { id: string; name: string }[] } {
	const picks = new Map<string, string>();
	const out = text.replace(TOKEN_RE, (token, id: string) => {
		const name = names[id];
		if (name === undefined) return token;
		picks.set(id, name);
		return `@${name}`;
	});
	return { text: out, picks: [...picks].map(([id, name]) => ({ id, name })) };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turns `@<name>` of picked members back into tokens; longer names win over their prefixes. A
 * name only matches when followed by the end of the text, whitespace or punctuation (not a letter,
 * digit, mark or underscore), so a picked "Lena" never swallows the start of "@Lenara". Blank picks
 * are ignored.
 */
export function encodeMentions(text: string, picked: { id: string; name: string }[]): string {
	let out = text;
	const usable = picked.filter((p) => p.name.trim() !== '');
	for (const p of usable.sort((a, b) => b.name.length - a.name.length)) {
		const re = new RegExp(`@${escapeRegExp(p.name)}(?![\\p{L}\\p{N}\\p{M}_])`, 'gu');
		out = out.replace(re, () => mentionToken(p.id));
	}
	return out;
}

/**
 * The `@query` being completed at the caret: index of the `@` and the query text. Board names may
 * contain a space, so the query may span two words ("Lena K."); null when the text before the caret
 * is not one (or it exceeds 50 characters, the API's limit).
 */
export function mentionQuery(beforeCaret: string): { start: number; q: string } | null {
	const m = /(?:^|\s)@([^\s@]{1,50}(?: [^\s@]{0,50})?)$/.exec(beforeCaret);
	if (!m || m[1].length > 50) return null;
	return { start: beforeCaret.length - m[1].length - 1, q: m[1] };
}
