import { db } from './db';
import { reports, timeouts } from './db/schema';
import { testUser } from './db/test-utils';
import { env } from './env';
import type { ContentType } from './moderation';

/** Inserts `n` open reports on a content item, each from a fresh distinct reporter. Returns the reporter ids. */
export async function addOpenReports(
	contentType: ContentType,
	contentId: number,
	authorId: number,
	n: number
): Promise<number[]> {
	const reporterIds: number[] = [];
	for (let i = 0; i < n; i++) {
		const reporter = await testUser();
		reporterIds.push(reporter.id);
		await db.insert(reports).values({
			contentType,
			contentId,
			reporterId: reporter.id,
			authorId,
			category: 'spam',
			excerpt: 'x'
		});
	}
	return reporterIds;
}

/** Reports needed to push content strictly above the review threshold. */
export const OVER_THRESHOLD = env.REPORT_REVIEW_THRESHOLD + 1;

/** Gives a user an active timeout (setBy any user id). */
export async function timeOut(userId: number, setBy: number): Promise<void> {
	await db.insert(timeouts).values({
		userId,
		setBy,
		reason: 'test',
		until: new Date(Date.now() + 86_400_000)
	});
}
