import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { auditLog, maintenance } from './db/schema';
import { resetDb, setupDb, testUser } from './db/test-utils';
import {
	canWrite,
	configureMaintenance,
	currentStatus,
	getMaintenance,
	MaintenanceInputError,
	resetMaintenance,
	resolveState,
	setMaintenance,
	statusMessage,
	type AppState,
	type MaintenanceRow
} from './maintenance';
import { configureReadiness, resetReadiness, setMigrated, type Readiness } from './readiness';

beforeAll(setupDb);
beforeEach(resetDb);
afterEach(() => {
	resetMaintenance();
	resetReadiness();
	setMigrated(true);
});
afterAll(resetDb);

const NOW = new Date('2026-10-24T16:00:00.000Z'); // 24 Oct 2026, 18:00 Berlin
const at = (iso: string) => new Date(iso);

const healthy: Readiness = { db: true, migrated: true, storage: true, checkedAt: NOW };
const off: MaintenanceRow = { enabled: false, message: '', startsAt: null, until: null };
const on: MaintenanceRow = { ...off, enabled: true };

async function admin(): Promise<SessionUser> {
	const u = await testUser({ role: 'admin' });
	return { id: u.id, username: u.username, displayName: null, role: 'admin' };
}

describe('precedence', () => {
	const ahead = { ...on, startsAt: at('2026-10-24T17:00:00Z') };
	const cases: [string, Partial<Readiness>, MaintenanceRow, AppState][] = [
		['everything fine', {}, off, 'ok'],
		['planned window ahead', {}, ahead, 'announced'],
		['switch active', {}, on, 'maintenance'],
		['storage down beats the switch', { storage: false }, on, 'not_ready'],
		['storage down beats announced', { storage: false }, ahead, 'not_ready'],
		['db down beats everything', { db: false, storage: false }, on, 'down'],
		['not migrated beats everything', { migrated: false, storage: false }, on, 'down']
	];
	it.each(cases)('%s', (_name, partial, row, expected) => {
		expect(resolveState({ ...healthy, ...partial }, row, NOW)).toBe(expected);
	});
});

describe('window', () => {
	it('is announced before startsAt and everybody may still write', () => {
		const row = { ...on, startsAt: at('2026-10-24T16:30:00Z'), until: at('2026-10-24T17:00:00Z') };
		const state = resolveState(healthy, row, NOW);
		expect(state).toBe('announced');
		expect(canWrite(state, 'member')).toBe(true);
	});

	it('is maintenance between startsAt and until: members blocked, admins may write', () => {
		const row = { ...on, startsAt: at('2026-10-24T15:00:00Z'), until: at('2026-10-24T17:00:00Z') };
		const state = resolveState(healthy, row, NOW);
		expect(state).toBe('maintenance');
		expect(canWrite(state, 'member')).toBe(false);
		expect(canWrite(state, 'moderator')).toBe(false);
		expect(canWrite(state, 'admin')).toBe(true);
	});

	it('is ok once until has passed', () => {
		const row = { ...on, startsAt: at('2026-10-24T14:00:00Z'), until: at('2026-10-24T15:00:00Z') };
		expect(resolveState(healthy, row, NOW)).toBe('ok');
		expect(resolveState(healthy, { ...on, until: at('2026-10-24T15:00:00Z') }, NOW)).toBe('ok');
	});

	it('is ok when the switch is off, whatever the dates say', () => {
		const row = { ...off, startsAt: at('2026-10-24T15:00:00Z'), until: at('2026-10-24T17:00:00Z') };
		expect(resolveState(healthy, row, NOW)).toBe('ok');
	});

	it('canWrite: not_ready and down block everybody, ok and announced allow everybody', () => {
		for (const role of ['member', 'moderator', 'admin', null] as const) {
			expect(canWrite('not_ready', role)).toBe(false);
			expect(canWrite('down', role)).toBe(false);
		}
		expect(canWrite('ok', 'member')).toBe(true);
		expect(canWrite('announced', 'member')).toBe(true);
	});
});

describe('messages', () => {
	it('ok has none', () => {
		expect(statusMessage('ok', off, 'member')).toBeNull();
	});

	it('maintenance: default text, custom text, Back around suffix, admin addendum', () => {
		expect(statusMessage('maintenance', on, 'member')).toBe(
			'Loki is under maintenance. Reading works, posting is paused.'
		);
		expect(statusMessage('maintenance', { ...on, message: 'Deploy in progress.' }, 'member')).toBe(
			'Deploy in progress.'
		);
		const until = at('2026-10-24T16:30:00Z');
		expect(statusMessage('maintenance', { ...on, until }, 'member')).toBe(
			'Loki is under maintenance. Reading works, posting is paused. Back around 24 Oct 2026, 18:30.'
		);
		expect(statusMessage('maintenance', { ...on, message: 'Deploy.', until }, 'moderator')).toBe(
			'Deploy. Back around 24 Oct 2026, 18:30.'
		);
		expect(statusMessage('maintenance', { ...on, until }, 'admin')).toBe(
			'Loki is under maintenance. Reading works, posting is paused. Back around 24 Oct 2026, 18:30. You are an admin, so you can still post.'
		);
	});

	it('terminates an unpunctuated admin message before the suffix and the addendum', () => {
		const until = at('2026-10-24T16:30:00Z');
		const row = { ...on, message: 'Deploy in progress', until };
		expect(statusMessage('maintenance', row, 'member')).toBe(
			'Deploy in progress. Back around 24 Oct 2026, 18:30.'
		);
		expect(statusMessage('maintenance', { ...on, message: 'Deploy in progress' }, 'admin')).toBe(
			'Deploy in progress. You are an admin, so you can still post.'
		);
		expect(statusMessage('maintenance', { ...row, message: 'Deploy in progress!' }, 'member')).toBe(
			'Deploy in progress! Back around 24 Oct 2026, 18:30.'
		);
		expect(statusMessage('maintenance', { ...on, message: 'Is it done?' }, 'admin')).toBe(
			'Is it done? You are an admin, so you can still post.'
		);
	});

	it('announced: with and without an end', () => {
		const startsAt = at('2026-10-24T16:00:00Z');
		expect(statusMessage('announced', { ...on, startsAt }, 'member')).toBe(
			'Heads up: maintenance 24 Oct 2026, 18:00. Reading will keep working.'
		);
		expect(
			statusMessage('announced', { ...on, startsAt, until: at('2026-10-24T17:00:00Z') }, 'admin')
		).toBe('Heads up: maintenance 24 Oct 2026, 18:00 to 19:00. Reading will keep working.');
	});

	it('not_ready', () => {
		expect(statusMessage('not_ready', off, 'member')).toBe(
			'Loki is still starting up. Posting, voting and commenting are back in a moment.'
		);
	});

	it('down has none (the outage page carries its own text)', () => {
		expect(statusMessage('down', off, null)).toBeNull();
	});
});

describe('setMaintenance and getMaintenance', () => {
	it('returns defaults when no row exists', async () => {
		expect(await getMaintenance()).toEqual(off);
	});

	it('stores the row and writes the audit entry with the exact detail', async () => {
		const actor = await admin();
		const startsAt = at('2026-10-24T16:00:00.000Z');
		const until = at('2026-10-24T17:00:00.000Z');
		await setMaintenance(actor, { enabled: true, message: 'Deploy', startsAt, until });
		expect(await getMaintenance()).toEqual({ enabled: true, message: 'Deploy', startsAt, until });
		const [row] = await db.select().from(maintenance);
		expect(row.id).toBe(1);
		expect(row.updatedBy).toBe(actor.id);

		const audits = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.action, 'maintenance_changed'));
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			actorId: actor.id,
			targetType: 'maintenance',
			targetId: 1,
			detail:
				'enabled=true message="Deploy" starts=2026-10-24T16:00:00.000Z until=2026-10-24T17:00:00.000Z'
		});
	});

	it('upserts the single row and writes "none" for missing dates', async () => {
		const actor = await admin();
		await setMaintenance(actor, { enabled: true, message: 'a', startsAt: null, until: null });
		await setMaintenance(actor, { enabled: false, message: '', startsAt: null, until: null });
		expect(await db.select().from(maintenance)).toHaveLength(1);
		expect(await getMaintenance()).toEqual(off);
		const details = (await db.select().from(auditLog).orderBy(auditLog.id)).map((r) => r.detail);
		expect(details).toEqual([
			'enabled=true message="a" starts=none until=none',
			'enabled=false message="" starts=none until=none'
		]);
	});

	it('rejects a message over 300 characters', async () => {
		const actor = await admin();
		const input = { enabled: true, message: 'x'.repeat(301), startsAt: null, until: null };
		await expect(setMaintenance(actor, input)).rejects.toThrow(MaintenanceInputError);
		await expect(setMaintenance(actor, input)).rejects.toThrow(
			'The message can have at most 300 characters.'
		);
		await expect(
			setMaintenance(actor, { ...input, message: 'x'.repeat(300) })
		).resolves.toBeUndefined();
	});

	it('rejects an end that is not after the start', async () => {
		const actor = await admin();
		const t = at('2026-10-24T16:00:00Z');
		for (const until of [t, at('2026-10-24T15:00:00Z')]) {
			const input = { enabled: true, message: '', startsAt: t, until };
			await expect(setMaintenance(actor, input)).rejects.toThrow(MaintenanceInputError);
			await expect(setMaintenance(actor, input)).rejects.toThrow(
				'The end must be after the start.'
			);
		}
		expect(await db.select().from(maintenance)).toHaveLength(0);
		expect(await db.select().from(auditLog)).toHaveLength(0);
	});
});

describe('currentStatus', () => {
	function ready(partial: Partial<Readiness> = {}) {
		configureReadiness({
			dbProbe: async () => partial.db ?? true,
			storageProbe: async () => partial.storage ?? true
		});
		setMigrated(partial.migrated ?? true);
	}
	const member: SessionUser = { id: 1, username: 'm', displayName: null, role: 'member' };
	const adminUser: SessionUser = { id: 2, username: 'a', displayName: null, role: 'admin' };

	it('ok: null message, writable', async () => {
		ready();
		expect(await currentStatus(member)).toEqual({
			state: 'ok',
			message: null,
			writable: true,
			nextChangeAt: null
		});
	});

	it('maintenance: members blocked, admins writable with addendum, anonymous blocked', async () => {
		ready();
		configureMaintenance({ load: async () => on });
		const text = 'Loki is under maintenance. Reading works, posting is paused.';
		expect(await currentStatus(member)).toEqual({
			state: 'maintenance',
			message: text,
			writable: false,
			nextChangeAt: null
		});
		expect(await currentStatus(adminUser)).toEqual({
			state: 'maintenance',
			message: `${text} You are an admin, so you can still post.`,
			writable: true,
			nextChangeAt: null
		});
		expect((await currentStatus(null)).writable).toBe(false);
	});

	it('uses the injected clock and the explicit now argument', async () => {
		ready();
		const row = { ...on, startsAt: at('2026-10-24T17:00:00Z') };
		configureMaintenance({ load: async () => row, now: () => NOW });
		expect((await currentStatus(member)).state).toBe('announced');
		expect((await currentStatus(member, at('2026-10-24T17:30:00Z'))).state).toBe('maintenance');
	});

	it('nextChangeAt is the earliest future start or end of the window', async () => {
		ready();
		const startsAt = at('2026-10-24T17:00:00Z');
		const until = at('2026-10-24T19:00:00Z');
		configureMaintenance({ load: async () => ({ ...on, startsAt, until }), now: () => NOW });
		expect((await currentStatus(member)).nextChangeAt).toBe(startsAt.toISOString());
		const during = await currentStatus(member, at('2026-10-24T17:30:00Z'));
		expect(during.state).toBe('maintenance');
		expect(during.nextChangeAt).toBe(until.toISOString());
		configureMaintenance({ load: async () => on });
		expect((await currentStatus(member)).nextChangeAt).toBeNull();
		configureMaintenance({ load: async () => ({ ...off, startsAt, until }) });
		expect((await currentStatus(member)).nextChangeAt).toBeNull();
	});

	it('not_ready when storage is down', async () => {
		ready({ storage: false });
		expect((await currentStatus(adminUser)).state).toBe('not_ready');
	});

	it('down when the maintenance row cannot be loaded', async () => {
		ready();
		configureMaintenance({
			load: async () => {
				throw new Error('relation "maintenance" does not exist');
			}
		});
		expect(await currentStatus(adminUser)).toEqual({
			state: 'down',
			message: null,
			writable: false,
			nextChangeAt: null
		});
	});

	it('down when the database is down', async () => {
		ready({ db: false });
		expect((await currentStatus(member)).state).toBe('down');
	});
});
