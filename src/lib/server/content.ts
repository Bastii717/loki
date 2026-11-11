import { eq } from 'drizzle-orm';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { db } from './db';
import { siteContent, users } from './db/schema';
import { AUDIT_ACTIONS, assertNotTimedOut, audit } from './moderation';
import type { SessionUser } from './auth/session';

export type ContentKey = 'rules' | 'faq';

export const MAX_CONTENT_LENGTH = 50_000;

export class ContentPermissionError extends Error {
	constructor() {
		super('Only admins may edit this content');
	}
}

export interface SiteContent {
	html: string;
	markdown: string;
	updatedAt: Date | null;
}

/** DOMPurify's default allows these; they have no place in rules/FAQ text (UI redress, fake forms). */
const FORBIDDEN_TAGS = ['style', 'form', 'input'];

/** Markdown -> HTML, sanitized so the result is safe to render with {@html}. */
function render(markdown: string): string {
	return DOMPurify.sanitize(marked.parse(markdown, { async: false }), {
		FORBID_TAGS: FORBIDDEN_TAGS
	});
}

export async function getContent(key: ContentKey): Promise<SiteContent> {
	const [row] = await db.select().from(siteContent).where(eq(siteContent.key, key));
	if (!row) return { html: '', markdown: '', updatedAt: null };
	return { html: render(row.markdown), markdown: row.markdown, updatedAt: row.updatedAt };
}

/**
 * Admin only, and not while timed out (an admin's timeout suspends their write rights like anybody's).
 * Every real change is audited (site_content_changed, the key as detail) in the same transaction.
 * Unchanged markdown is not saved at all: a no-op save must not bump `updatedAt`, which would make
 * every member re-accept unchanged rules. Saving the rules counts as the admin's own acceptance.
 */
export async function saveContent(
	user: SessionUser,
	key: ContentKey,
	markdown: string
): Promise<void> {
	if (user.role !== 'admin') throw new ContentPermissionError();
	await assertNotTimedOut(user);
	const now = new Date();
	const values = { markdown, updatedBy: user.id, updatedAt: now };
	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ markdown: siteContent.markdown })
			.from(siteContent)
			.where(eq(siteContent.key, key));
		if (existing?.markdown === markdown) return;
		await tx
			.insert(siteContent)
			.values({ key, ...values })
			.onConflictDoUpdate({ target: siteContent.key, set: values });
		if (key === 'rules') {
			await tx.update(users).set({ rulesAcceptedAt: now }).where(eq(users.id, user.id));
		}
		await audit(user.id, AUDIT_ACTIONS.siteContentChanged, 'site_content', 0, key, tx);
	});
}

/**
 * True when there are rules and the member has not accepted their current version: never accepted,
 * or accepted before the last change. One primary-key query; called on mutations and the root layout load.
 */
export async function needsRulesAcceptance(user: {
	rulesAcceptedAt: Date | null;
}): Promise<boolean> {
	const [row] = await db
		.select({ markdown: siteContent.markdown, updatedAt: siteContent.updatedAt })
		.from(siteContent)
		.where(eq(siteContent.key, 'rules'));
	if (!row || row.markdown.trim() === '') return false;
	return user.rulesAcceptedAt === null || user.rulesAcceptedAt < row.updatedAt;
}

/** Records that the member accepted the house rules now. No timeout check: accepting is not a content write. */
export async function acceptRules(userId: number): Promise<void> {
	await db.update(users).set({ rulesAcceptedAt: new Date() }).where(eq(users.id, userId));
}
