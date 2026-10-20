import { eq } from 'drizzle-orm';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { db } from './db';
import { siteContent } from './db/schema';
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

/** Markdown -> HTML, sanitized so the result is safe to render with {@html}. */
function render(markdown: string): string {
	return DOMPurify.sanitize(marked.parse(markdown, { async: false }));
}

export async function getContent(key: ContentKey): Promise<SiteContent> {
	const [row] = await db.select().from(siteContent).where(eq(siteContent.key, key));
	if (!row) return { html: '', markdown: '', updatedAt: null };
	return { html: render(row.markdown), markdown: row.markdown, updatedAt: row.updatedAt };
}

/** Admin only. */
export async function saveContent(
	user: SessionUser,
	key: ContentKey,
	markdown: string
): Promise<void> {
	if (user.role !== 'admin') throw new ContentPermissionError();
	const values = { markdown, updatedBy: user.id, updatedAt: new Date() };
	await db
		.insert(siteContent)
		.values({ key, ...values })
		.onConflictDoUpdate({ target: siteContent.key, set: values });
}
