/** @-mentions are stored as `@[u:<public id>]` tokens and rendered as the member's board name. Client-safe. */
export const MAX_MENTIONS = 5;

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

/** Turns `@<name>` of picked members back into tokens; longer names win over their prefixes. */
export function encodeMentions(text: string, picked: { id: string; name: string }[]): string {
	let out = text;
	for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
		out = out.split(`@${p.name}`).join(mentionToken(p.id));
	}
	return out;
}
