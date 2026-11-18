import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { formatDate } from '../moderation-labels';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { auditLog, notifications, users } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import { TimeoutActiveError } from './moderation';
import { timeOut } from './moderation-test-utils';
import {
	clearMotto,
	getProfile,
	nameKey,
	nextRenameAt,
	normalizeDisplayName,
	ProfileInputError,
	resetDisplayName,
	setDisplayName,
	setMotto,
	validateDisplayName
} from './profile';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(resetDb);

const DAY = 86_400_000;
const NOW = new Date('2026-10-27T12:00:00.000Z');
const FORMAT_MESSAGE = 'Pick 2 to 24 characters: letters, digits, spaces, dashes or underscores.';

async function make(role: SessionUser['role'] = 'member', username?: string): Promise<SessionUser> {
	const u = await testUser(username ? { role, username } : { role });
	return { id: u.id, username: u.username, displayName: u.displayName, role };
}

async function auditRows() {
	return db.select().from(auditLog).orderBy(auditLog.id);
}

async function noticesOf(userId: number) {
	return db.select().from(notifications).where(eq(notifications.userId, userId));
}

describe('display name format', () => {
	const accepted: [string, string][] = [
		['ro nja', 'ro nja'],
		['ro  nja', 'ro nja'],
		[' ronja ', 'ronja'],
		['Rönja', 'Rönja'],
		['Ba\u0308sti', 'B\u00e4sti'],
		['名前', '名前'],
		['a-b_c', 'a-b_c']
	];
	it.each(accepted)('accepts %j as %j', (raw, normalized) => {
		const name = normalizeDisplayName(raw);
		expect(name).toBe(normalized);
		expect(() => validateDisplayName(name)).not.toThrow();
	});

	const rejected: [string, string][] = [
		['b', 'too short'],
		['x'.repeat(25), 'too long'],
		['r@nja', 'at sign'],
		['ro.nja', 'dot'],
		['-ronja', 'leading dash'],
		['ronja_', 'trailing underscore'],
		['', 'empty'],
		['Lena\u3164', 'Hangul filler'],
		['Lena\u115F', 'Hangul choseong filler'],
		['Lena\u200D', 'zero width joiner'],
		['\u3164\u3164', 'only fillers'],
		['Le\u200Bna', 'zero width space inside']
	];
	it.each(rejected)('rejects %j (%s)', (raw) => {
		const name = normalizeDisplayName(raw);
		expect(() => validateDisplayName(name)).toThrow(new ProfileInputError(FORMAT_MESSAGE));
	});

	it('rejects a double space when validating directly', () => {
		expect(() => validateDisplayName('ro  nja')).toThrow(new ProfileInputError(FORMAT_MESSAGE));
	});

	it('accepts exactly 24 characters and counts code points, not UTF-16 units', () => {
		expect(() => validateDisplayName('x'.repeat(24))).not.toThrow();
		expect(() => validateDisplayName('𠀀'.repeat(24))).not.toThrow();
		expect(() => validateDisplayName('𠀀'.repeat(25))).toThrow(ProfileInputError);
	});
});

describe('nameKey', () => {
	it('ignores case, spaces, dots, dashes and underscores', () => {
		expect(nameKey('Le na')).toBe('lena');
		expect(nameKey('le_na')).toBe('lena');
		expect(nameKey('Le-Na')).toBe('lena');
		expect(nameKey('mira.lang')).toBe('miralang');
	});

	it('ignores invisible characters', () => {
		expect(nameKey('Le\u200Bna')).toBe('lena');
		expect(nameKey('Lena\u3164')).toBe('lena');
		expect(nameKey('Lena\uFFA0')).toBe('lena');
	});

	it('applies NFKC', () => {
		expect(nameKey('ＬＥＮＡ')).toBe('lena');
	});
});

describe('display name key index', () => {
	it('rejects two users with the same key but allows any number without one', async () => {
		await testUser({ displayName: 'Le na', displayNameKey: 'lena' });
		await expect(testUser({ displayName: 'lena', displayNameKey: 'lena' })).rejects.toThrow();
		await testUser();
		await testUser();
	});
});

describe('nextRenameAt', () => {
	it('is null without a previous change and once the cooldown is over', () => {
		expect(nextRenameAt(null, NOW)).toBeNull();
		expect(nextRenameAt(new Date(NOW.getTime() - 30 * DAY), NOW)).toBeNull();
		expect(nextRenameAt(new Date(NOW.getTime() - 31 * DAY), NOW)).toBeNull();
	});

	it('is the end of the cooldown while it runs', () => {
		const changed = new Date(NOW.getTime() - DAY);
		expect(nextRenameAt(changed, NOW)).toEqual(new Date(changed.getTime() + 30 * DAY));
	});
});

describe('setDisplayName: uniqueness', () => {
	it('rejects a name whose key equals another display name', async () => {
		const a = await make();
		const b = await make();
		await setDisplayName(a, a.id, 'Le na', NOW);
		await expect(setDisplayName(b, b.id, 'lena', NOW)).rejects.toThrow(
			new ProfileInputError('That name is taken.')
		);
	});

	it("rejects a name whose key equals another user's username", async () => {
		await make('member', 'mira.lang');
		const b = await make();
		await expect(setDisplayName(b, b.id, 'mira_lang', NOW)).rejects.toThrow(
			new ProfileInputError('That name is taken.')
		);
	});

	it('allows the own username and the own current name in another spelling', async () => {
		const a = await make('member', 'mira.lang');
		await setDisplayName(a, a.id, 'Mira Lang', NOW);
		expect((await getProfile(a.id)).displayName).toBe('Mira Lang');
		await setDisplayName(a, a.id, 'mira_lang', new Date(NOW.getTime() + 31 * DAY));
		expect((await getProfile(a.id)).displayName).toBe('mira_lang');
	});

	it('rejects an invalid format before touching the database', async () => {
		const a = await make();
		await expect(setDisplayName(a, a.id, 'ro.nja', NOW)).rejects.toThrow(
			new ProfileInputError(FORMAT_MESSAGE)
		);
		expect(await auditRows()).toHaveLength(0);
	});
});

describe('setDisplayName: self', () => {
	it('stores name, key and timestamp and audits it', async () => {
		const a = await make();
		await setDisplayName(a, a.id, ' ronja ', NOW);
		const [row] = await db.select().from(users).where(eq(users.id, a.id));
		expect(row.displayName).toBe('ronja');
		expect(row.displayNameKey).toBe('ronja');
		expect(row.displayNameChangedAt).toEqual(NOW);
		expect(row.displayNameSetBy).toBeNull();
		const rows = await auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: a.id,
			action: 'display_name_changed',
			targetType: 'user',
			targetId: a.id,
			detail: 'from="none" to="ronja" by=self'
		});
	});

	it('audits the previous name on a later change', async () => {
		const a = await make();
		await setDisplayName(a, a.id, 'ronja', NOW);
		await setDisplayName(a, a.id, 'noah', new Date(NOW.getTime() + 30 * DAY));
		const rows = await auditRows();
		expect(rows[1].detail).toBe('from="ronja" to="noah" by=self');
	});

	it('blocks a second rename a day later with the exact date, allows it after 30 days', async () => {
		const a = await make();
		await setDisplayName(a, a.id, 'ronja', NOW);
		const later = new Date(NOW.getTime() + DAY);
		const date = formatDate(new Date(NOW.getTime() + 30 * DAY).toISOString());
		await expect(setDisplayName(a, a.id, 'noah', later)).rejects.toThrow(
			new ProfileInputError(`You can change your name again on ${date}.`)
		);
		expect((await getProfile(a.id)).displayName).toBe('ronja');
		await setDisplayName(a, a.id, 'noah', new Date(NOW.getTime() + 30 * DAY));
		expect((await getProfile(a.id)).displayName).toBe('noah');
	});

	it('rejects a muted member with TimeoutActiveError', async () => {
		const a = await make();
		const mod = await make('moderator');
		await timeOut(a.id, mod.id);
		await expect(setDisplayName(a, a.id, 'ronja', NOW)).rejects.toThrow(TimeoutActiveError);
		expect((await getProfile(a.id)).displayName).toBeNull();
	});

	it('lets an admin rename themselves without the cooldown', async () => {
		const admin = await make('admin');
		await setDisplayName(admin, admin.id, 'chief', NOW);
		await setDisplayName(admin, admin.id, 'boss', new Date(NOW.getTime() + DAY));
		expect((await getProfile(admin.id)).displayName).toBe('boss');
	});
});

describe('setDisplayName: other members', () => {
	it('lets an admin rename without cooldown, records setBy and audits by=admin', async () => {
		const admin = await make('admin');
		const m = await make();
		await setDisplayName(m, m.id, 'ronja', NOW);
		await setDisplayName(admin, m.id, 'Noah', new Date(NOW.getTime() + DAY));
		const [row] = await db.select().from(users).where(eq(users.id, m.id));
		expect(row.displayName).toBe('Noah');
		expect(row.displayNameSetBy).toBe(admin.id);
		expect(row.displayNameChangedAt).toEqual(new Date(NOW.getTime() + DAY));
		const rows = await auditRows();
		expect(rows[1]).toMatchObject({
			actorId: admin.id,
			action: 'display_name_changed',
			targetType: 'user',
			targetId: m.id,
			detail: 'from="ronja" to="Noah" by=admin'
		});
	});

	it("starts the member's own cooldown at the admin change", async () => {
		const admin = await make('admin');
		const m = await make();
		const changed = new Date(NOW.getTime() + DAY);
		await setDisplayName(admin, m.id, 'Noah', changed);
		const date = formatDate(new Date(changed.getTime() + 30 * DAY).toISOString());
		await expect(
			setDisplayName(m, m.id, 'ronja', new Date(changed.getTime() + DAY))
		).rejects.toThrow(new ProfileInputError(`You can change your name again on ${date}.`));
		expect((await getProfile(m.id)).displayName).toBe('Noah');
	});

	it('does not require the admin to be free of a timeout on the target', async () => {
		const admin = await make('admin');
		const m = await make();
		await timeOut(m.id, admin.id);
		await setDisplayName(admin, m.id, 'Noah', NOW);
		expect((await getProfile(m.id)).displayName).toBe('Noah');
	});

	it('rejects moderators and members renaming someone else', async () => {
		const mod = await make('moderator');
		const m = await make();
		const other = await make();
		const message = new ProfileInputError('Only admins can rename other members.');
		await expect(setDisplayName(mod, m.id, 'ronja', NOW)).rejects.toThrow(message);
		await expect(setDisplayName(other, m.id, 'ronja', NOW)).rejects.toThrow(message);
		expect((await getProfile(m.id)).displayName).toBeNull();
	});

	it('rejects an unknown member', async () => {
		const admin = await make('admin');
		await expect(setDisplayName(admin, 9999, 'ronja', NOW)).rejects.toThrow(ProfileInputError);
	});
});

describe('resetDisplayName', () => {
	it('clears name, key, timestamp and setBy and audits it', async () => {
		const admin = await make('admin');
		const m = await make();
		await setDisplayName(admin, m.id, 'ronja', NOW);
		await resetDisplayName(admin, m.id);
		const [row] = await db.select().from(users).where(eq(users.id, m.id));
		expect(row.displayName).toBeNull();
		expect(row.displayNameKey).toBeNull();
		expect(row.displayNameChangedAt).toBeNull();
		expect(row.displayNameSetBy).toBeNull();
		const rows = await auditRows();
		expect(rows[1]).toMatchObject({
			actorId: admin.id,
			action: 'display_name_reset',
			targetType: 'user',
			targetId: m.id,
			detail: ''
		});
	});

	it('does nothing for a member without a display name', async () => {
		const admin = await make('admin');
		const m = await make();
		await resetDisplayName(admin, m.id);
		expect(await auditRows()).toEqual([]);
		expect(await noticesOf(m.id)).toEqual([]);
	});

	it('still reports an unknown member', async () => {
		const admin = await make('admin');
		await expect(resetDisplayName(admin, 999_999)).rejects.toThrow(
			new ProfileInputError('Member not found.')
		);
	});

	it('is admin only', async () => {
		const mod = await make('moderator');
		const m = await make();
		await setDisplayName(m, m.id, 'ronja', NOW);
		await expect(resetDisplayName(mod, m.id)).rejects.toThrow(ProfileInputError);
		await expect(resetDisplayName(m, m.id)).rejects.toThrow(ProfileInputError);
		expect((await getProfile(m.id)).displayName).toBe('ronja');
	});

	it('frees the name for someone else', async () => {
		const admin = await make('admin');
		const a = await make();
		const b = await make();
		await setDisplayName(a, a.id, 'ronja', NOW);
		await resetDisplayName(admin, a.id);
		await setDisplayName(b, b.id, 'ronja', NOW);
		expect((await getProfile(b.id)).displayName).toBe('ronja');
	});
});

describe('motto', () => {
	it('rejects 81 characters, accepts 80', async () => {
		const a = await make();
		await expect(setMotto(a, 'x'.repeat(81))).rejects.toThrow(
			new ProfileInputError('The motto can have at most 80 characters.')
		);
		await setMotto(a, 'x'.repeat(80));
		expect((await getProfile(a.id)).motto).toBe('x'.repeat(80));
	});

	it('trims and replaces line breaks (CRLF included) with a single space', async () => {
		const a = await make();
		await setMotto(a, '  hello\r\nworld\nagain  ');
		expect((await getProfile(a.id)).motto).toBe('hello world again');
	});

	it('treats NEL, LS, PS, VT and FF as line breaks too', async () => {
		const a = await make();
		await setMotto(a, 'a\u0085b\u2028c\u2029d\ve\ff');
		expect((await getProfile(a.id)).motto).toBe('a b c d e f');
	});

	it('drops C0 controls such as NUL and maps tabs to spaces', async () => {
		const a = await make();
		await setMotto(a, 'a\u0000b\tc\u001Fd\u007Fe');
		expect((await getProfile(a.id)).motto).toBe('ab cde');
	});

	it('treats an empty motto as a clear, not a change', async () => {
		const a = await make();
		await setMotto(a, 'carpe diem');
		await setMotto(a, ' \r\n ');
		expect((await getProfile(a.id)).motto).toBe('');
		const rows = await auditRows();
		expect(rows.map((r) => [r.action, r.detail])).toEqual([
			['motto_changed', 'to="carpe diem"'],
			['motto_cleared', 'by=self']
		]);
	});

	it('clears an already empty motto without an audit row', async () => {
		const a = await make();
		await clearMotto(a, a.id);
		expect(await auditRows()).toHaveLength(0);
	});

	it('audits motto_changed', async () => {
		const a = await make();
		await setMotto(a, 'carpe diem');
		const rows = await auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: a.id,
			action: 'motto_changed',
			targetType: 'user',
			targetId: a.id,
			detail: 'to="carpe diem"'
		});
	});

	it('rejects setMotto for a muted member but allows clearing the own motto', async () => {
		const a = await make();
		const mod = await make('moderator');
		await setMotto(a, 'carpe diem');
		await timeOut(a.id, mod.id);
		await expect(setMotto(a, 'new')).rejects.toThrow(TimeoutActiveError);
		await clearMotto(a, a.id);
		expect((await getProfile(a.id)).motto).toBe('');
		const rows = await auditRows();
		expect(rows[1]).toMatchObject({ action: 'motto_cleared', detail: 'by=self' });
	});

	it('lets an admin clear another motto (by=admin) but nobody else', async () => {
		const admin = await make('admin');
		const mod = await make('moderator');
		const m = await make();
		await setMotto(m, 'carpe diem');
		await expect(clearMotto(mod, m.id)).rejects.toThrow(ProfileInputError);
		expect((await getProfile(m.id)).motto).toBe('carpe diem');
		await clearMotto(admin, m.id);
		expect((await getProfile(m.id)).motto).toBe('');
		const rows = await auditRows();
		expect(rows[1]).toMatchObject({
			actorId: admin.id,
			action: 'motto_cleared',
			targetId: m.id,
			detail: 'by=admin'
		});
	});
});

describe('profile notices', () => {
	it('an admin renaming a member tells them the stored, normalised name', async () => {
		const admin = await make('admin');
		const m = await make();
		await setDisplayName(admin, m.id, '  Ba\u0308sti  ', NOW);
		const rows = await noticesOf(m.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'name_changed', actorId: null, detail: 'B\u00e4sti' });
		expect(await noticesOf(admin.id)).toHaveLength(0);
	});

	it('renaming yourself writes nothing, admin or not', async () => {
		const admin = await make('admin');
		const m = await make();
		await setDisplayName(m, m.id, 'ronja', NOW);
		await setDisplayName(admin, admin.id, 'chief', NOW);
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	it('a rejected rename writes nothing', async () => {
		const admin = await make('admin');
		const m = await make();
		const other = await make();
		await setDisplayName(other, other.id, 'ronja', NOW);
		await expect(setDisplayName(admin, m.id, 'ronja', NOW)).rejects.toThrow(ProfileInputError);
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	it('resetDisplayName tells the member', async () => {
		const admin = await make('admin');
		const m = await make();
		await setDisplayName(m, m.id, 'ronja', NOW);
		await resetDisplayName(admin, m.id);
		const rows = await noticesOf(m.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'name_reset', actorId: null, detail: '' });
	});

	it('an admin resetting their own name writes nothing', async () => {
		const admin = await make('admin');
		await resetDisplayName(admin, admin.id);
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	it('an admin clearing a motto tells the member', async () => {
		const admin = await make('admin');
		const m = await make();
		await setMotto(m, 'carpe diem');
		await clearMotto(admin, m.id);
		const rows = await noticesOf(m.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'motto_cleared', actorId: null, detail: '' });
	});

	it('clearing an empty motto, or your own, writes nothing', async () => {
		const admin = await make('admin');
		const m = await make();
		await clearMotto(admin, m.id);
		await setMotto(m, 'carpe diem');
		await clearMotto(m, m.id);
		expect(await db.select().from(notifications)).toHaveLength(0);
	});
});

describe('getProfile', () => {
	it('returns the profile columns and role', async () => {
		const a = await make('moderator', 'jane.doe');
		expect(await getProfile(a.id)).toEqual({
			username: 'jane.doe',
			displayName: null,
			displayNameChangedAt: null,
			displayNameSetBy: null,
			avatarKey: null,
			avatarThumbKey: null,
			motto: '',
			role: 'moderator'
		});
	});

	it('rejects an unknown member', async () => {
		await expect(getProfile(9999)).rejects.toThrow(ProfileInputError);
	});
});
