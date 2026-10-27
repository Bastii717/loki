import { eq, ne } from 'drizzle-orm';
import { formatDate } from '../moderation-labels';
import { DISPLAY_NAME_MAX, MOTTO_MAX } from '../profile-limits';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { users } from './db/schema';
import { assertNotTimedOut, audit, AUDIT_ACTIONS } from './moderation';

export const DISPLAY_NAME_MIN = 2;
export { DISPLAY_NAME_MAX, MOTTO_MAX };
export const RENAME_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]*[\p{L}\p{N}]$/u;

const FORMAT_MESSAGE = `Pick ${DISPLAY_NAME_MIN} to ${DISPLAY_NAME_MAX} characters: letters, digits, spaces, dashes or underscores.`;

type Role = SessionUser['role'];

/** Rejected profile input. The message is user-facing. */
export class ProfileInputError extends Error {}

/** NFC-normalises, trims and collapses runs of spaces to one. */
export function normalizeDisplayName(raw: string): string {
	// NFC first: a decomposed "ä" (a + U+0308) is two code points and would fail the letter check
	return raw.normalize('NFC').trim().replace(/ {2,}/g, ' ');
}

/** Comparison key: `Le na`, `lena` and `le_na` are one name. */
export function nameKey(name: string): string {
	return name
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\s._-]/g, '');
}

/** Throws the format message unless `name` (already normalised) is a valid display name. */
export function validateDisplayName(name: string): void {
	const length = [...name].length;
	if (
		length < DISPLAY_NAME_MIN ||
		length > DISPLAY_NAME_MAX ||
		name.includes('  ') ||
		!NAME_PATTERN.test(name)
	) {
		throw new ProfileInputError(FORMAT_MESSAGE);
	}
}

/** The instant a member may rename again, or null when they may do so now. */
export function nextRenameAt(changedAt: Date | null, now: Date): Date | null {
	if (!changedAt) return null;
	const next = new Date(changedAt.getTime() + RENAME_COOLDOWN_DAYS * DAY_MS);
	return next.getTime() > now.getTime() ? next : null;
}

/** Postgres unique violation, whether raised directly or wrapped by the driver/ORM. */
function isUniqueViolation(e: unknown): boolean {
	const codeOf = (x: unknown) => (x as { code?: string } | null)?.code;
	return codeOf(e) === '23505' || codeOf((e as { cause?: unknown } | null)?.cause) === '23505';
}

/**
 * Sets a display name. Members rename themselves (timeout and 30-day cooldown apply); admins may
 * rename anyone without the cooldown and are never held back by their own cooldown. Everybody
 * else is rejected for other members.
 */
export async function setDisplayName(
	actor: SessionUser,
	userId: number,
	raw: string,
	now: Date = new Date()
): Promise<void> {
	const self = actor.id === userId;
	if (!self && actor.role !== 'admin') {
		throw new ProfileInputError('Only admins can rename other members.');
	}
	const name = normalizeDisplayName(raw);
	validateDisplayName(name);
	if (self) await assertNotTimedOut(actor);
	const key = nameKey(name);

	try {
		await db.transaction(async (tx) => {
			const [target] = await tx
				.select({ displayName: users.displayName, changedAt: users.displayNameChangedAt })
				.from(users)
				.where(eq(users.id, userId))
				.for('update');
			if (!target) throw new ProfileInputError('Member not found.');

			if (self && actor.role !== 'admin') {
				const next = nextRenameAt(target.changedAt, now);
				if (next) {
					throw new ProfileInputError(
						`You can change your name again on ${formatDate(next.toISOString())}.`
					);
				}
			}

			// Another member's username can't be matched by the unique index (it holds display name
			// keys only), so compare in JS: for a 25 to 50 person team the full list is tiny, and it
			// avoids re-implementing the JS key rules (NFKC, lower-casing) in SQL where Postgres
			// collations could disagree. Display-name races are caught by the unique index below.
			const others = await tx
				.select({ username: users.username, key: users.displayNameKey })
				.from(users)
				.where(ne(users.id, userId));
			if (others.some((o) => o.key === key || nameKey(o.username) === key)) {
				throw new ProfileInputError('That name is taken.');
			}

			await tx
				.update(users)
				.set({
					displayName: name,
					displayNameKey: key,
					displayNameChangedAt: now,
					displayNameSetBy: self ? null : actor.id
				})
				.where(eq(users.id, userId));
			await audit(
				actor.id,
				AUDIT_ACTIONS.displayNameChanged,
				'user',
				userId,
				`from="${target.displayName ?? 'none'}" to="${name}" by=${self ? 'self' : 'admin'}`,
				tx
			);
		});
	} catch (e) {
		// Only reachable when two members race for the same key (the pre-check above passed for both),
		// so it cannot be triggered deterministically; users_display_name_key_idx itself is tested.
		if (isUniqueViolation(e)) throw new ProfileInputError('That name is taken.');
		throw e;
	}
}

/** Admin only: back to the username; clears the cooldown too. */
export async function resetDisplayName(actor: SessionUser, userId: number): Promise<void> {
	if (actor.role !== 'admin') throw new ProfileInputError('Only admins can reset names.');
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(users)
			.set({
				displayName: null,
				displayNameKey: null,
				displayNameChangedAt: null,
				displayNameSetBy: null
			})
			.where(eq(users.id, userId))
			.returning({ id: users.id });
		if (updated.length === 0) throw new ProfileInputError('Member not found.');
		await audit(actor.id, AUDIT_ACTIONS.displayNameReset, 'user', userId, '', tx);
	});
}

/** Line breaks (CR, LF, NEL, LS, PS, VT, FF) become one space, then trimmed. */
function normalizeMotto(raw: string): string {
	return raw.replace(/\s*[\r\n\u0085\u2028\u2029\v\f]+\s*/g, ' ').trim();
}

export async function setMotto(actor: SessionUser, raw: string): Promise<void> {
	await assertNotTimedOut(actor);
	const motto = normalizeMotto(raw);
	if ([...motto].length > MOTTO_MAX) {
		throw new ProfileInputError(`The motto can have at most ${MOTTO_MAX} characters.`);
	}
	// An empty motto is a clear, not a change to "".
	if (motto === '') return clearMotto(actor, actor.id);
	await db.transaction(async (tx) => {
		await tx.update(users).set({ motto }).where(eq(users.id, actor.id));
		await audit(actor.id, AUDIT_ACTIONS.mottoChanged, 'user', actor.id, `to="${motto}"`, tx);
	});
}

/** Self or admin. Stays allowed while timed out, like deleting own content. */
export async function clearMotto(actor: SessionUser, userId: number): Promise<void> {
	const self = actor.id === userId;
	if (!self && actor.role !== 'admin') {
		throw new ProfileInputError('Only admins can clear the motto of other members.');
	}
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(users)
			.set({ motto: '' })
			.where(eq(users.id, userId))
			.returning({ id: users.id });
		if (updated.length === 0) throw new ProfileInputError('Member not found.');
		await audit(
			actor.id,
			AUDIT_ACTIONS.mottoCleared,
			'user',
			userId,
			`by=${self ? 'self' : 'admin'}`,
			tx
		);
	});
}

export async function getProfile(userId: number): Promise<{
	username: string;
	displayName: string | null;
	displayNameChangedAt: Date | null;
	displayNameSetBy: number | null;
	avatarKey: string | null;
	avatarThumbKey: string | null;
	motto: string;
	role: Role;
}> {
	const [row] = await db
		.select({
			username: users.username,
			displayName: users.displayName,
			displayNameChangedAt: users.displayNameChangedAt,
			displayNameSetBy: users.displayNameSetBy,
			avatarKey: users.avatarKey,
			avatarThumbKey: users.avatarThumbKey,
			motto: users.motto,
			role: users.role
		})
		.from(users)
		.where(eq(users.id, userId));
	if (!row) throw new ProfileInputError('Member not found.');
	return row;
}
