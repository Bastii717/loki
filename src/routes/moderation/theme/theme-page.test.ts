import { desc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import { auditLog } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { userWithSession } from '../../../lib/server/moderation-test-utils';
import { getSeasonSettings } from '../../../lib/server/seasons';
import { actions, load } from './+page.server';

beforeAll(setupDb);
beforeEach(resetDb);

type Result = { status: number; data: Record<string, unknown> } | { saved: true };
type User = Awaited<ReturnType<typeof userWithSession>>['user'];

async function save(user: User, fields: Record<string, string>) {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	const request = new Request('https://loki.test/moderation/theme', { method: 'POST', body });
	return (await actions.save({ request, locals: { user } } as never)) as Result;
}

const audits = () =>
	db
		.select()
		.from(auditLog)
		.where(eq(auditLog.action, 'season_changed'))
		.orderBy(desc(auditLog.id));

type LoadData = {
	mode: string;
	theme: string;
	until: string;
	status: string;
	active: { id: string; source: string } | null;
	seasons: { id: string; label: string }[];
};
const loadAs = (user: User) => load({ locals: { user } } as never) as Promise<LoadData>;

describe('save action', () => {
	it('forces a theme with a Berlin end converted to UTC and audits once', async () => {
		const { user } = await userWithSession('admin');
		const result = await save(user, { mode: 'forced', theme: 'party', until: '2099-12-24T18:00' });
		expect(result).toEqual({ saved: true });
		expect(await getSeasonSettings()).toEqual({
			mode: 'forced',
			theme: 'party',
			until: new Date('2099-12-24T17:00:00Z')
		});
		const rows = await audits();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: user.id,
			targetType: 'season_settings',
			targetId: 1,
			detail: 'mode=forced theme=party until=2099-12-24T17:00:00.000Z'
		});
	});

	it('forces a theme without an end', async () => {
		const { user } = await userWithSession('admin');
		expect(await save(user, { mode: 'forced', theme: 'advent', until: '' })).toEqual({
			saved: true
		});
		expect(await getSeasonSettings()).toEqual({ mode: 'forced', theme: 'advent', until: null });
		expect((await audits())[0].detail).toBe('mode=forced theme=advent until=none');
	});

	it('rejects forcing without a theme and saves nothing', async () => {
		const { user } = await userWithSession('admin');
		const result = await save(user, { mode: 'forced', theme: '', until: '' });
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'Pick a theme to force.', mode: 'forced', theme: '' }
		});
		expect(await audits()).toHaveLength(0);
		expect(await getSeasonSettings()).toEqual({ mode: 'auto', theme: null, until: null });
	});

	it('rejects an unknown theme', async () => {
		const { user } = await userWithSession('admin');
		expect(await save(user, { mode: 'forced', theme: 'easter', until: '' })).toMatchObject({
			status: 400,
			data: { error: 'Pick a theme to force.' }
		});
	});

	it('rejects an end in the past and keeps what was typed', async () => {
		const { user } = await userWithSession('admin');
		const result = await save(user, { mode: 'forced', theme: 'party', until: '2020-01-01T10:00' });
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'The end must be in the future.', theme: 'party', until: '2020-01-01T10:00' }
		});
		expect(await audits()).toHaveLength(0);
	});

	it('rejects a malformed end', async () => {
		const { user } = await userWithSession('admin');
		const result = await save(user, { mode: 'forced', theme: 'party', until: 'soon' });
		expect(result).toMatchObject({ status: 400, data: { error: 'Enter a valid date and time.' } });
		expect(await audits()).toHaveLength(0);
	});

	it('sends no theme and no end for auto and off, even when the form still carries them', async () => {
		const { user } = await userWithSession('admin');
		await save(user, { mode: 'off', theme: 'party', until: '2020-01-01T10:00' });
		expect(await getSeasonSettings()).toEqual({ mode: 'off', theme: null, until: null });
		await save(user, { mode: 'auto', theme: 'advent', until: '2020-01-01T10:00' });
		expect(await getSeasonSettings()).toEqual({ mode: 'auto', theme: null, until: null });
		const rows = await audits();
		expect(rows.map((r) => r.detail)).toEqual([
			'mode=auto theme=none until=none',
			'mode=off theme=none until=none'
		]);
	});

	it('treats an unknown mode as automatic', async () => {
		const { user } = await userWithSession('admin');
		await save(user, { mode: 'bogus' });
		expect(await getSeasonSettings()).toEqual({ mode: 'auto', theme: null, until: null });
	});

	it('uses only named actions (SvelteKit rejects a default next to named ones)', () => {
		expect(Object.keys(actions).sort()).toEqual(['reset', 'save']);
	});

	it('refuses moderators', async () => {
		const { user } = await userWithSession('moderator');
		await expect(save(user, { mode: 'off' })).rejects.toMatchObject({ status: 403 });
		expect(await audits()).toHaveLength(0);
	});
});

describe('reset action', () => {
	it('goes back to automatic and audits', async () => {
		const { user } = await userWithSession('admin');
		await save(user, { mode: 'forced', theme: 'party', until: '2099-12-24T18:00' });
		expect(await actions.reset({ locals: { user } } as never)).toEqual({ saved: true });
		expect(await getSeasonSettings()).toEqual({ mode: 'auto', theme: null, until: null });
		const rows = await audits();
		expect(rows).toHaveLength(2);
		expect(rows[0].detail).toBe('mode=auto theme=none until=none');
	});

	it('refuses moderators', async () => {
		const { user } = await userWithSession('moderator');
		await expect(actions.reset({ locals: { user } } as never)).rejects.toMatchObject({
			status: 403
		});
		expect(await audits()).toHaveLength(0);
	});
});

describe('load', () => {
	it('lists the catalog and reports automatic by default', async () => {
		const { user } = await userWithSession('admin');
		const data = await loadAs(user);
		expect(data).toMatchObject({ mode: 'auto', theme: '', until: '' });
		expect(data.seasons.map((s) => s.id)).toEqual(['halloween', 'advent', 'carnival', 'party']);
		expect(data.status).toMatch(/^Active: (\w+ \(automatic\)|none \(automatic\))$/);
	});

	it('describes a forced theme with its Berlin end', async () => {
		const { user } = await userWithSession('admin');
		await save(user, { mode: 'forced', theme: 'advent', until: '2099-12-24T18:00' });
		const data = await loadAs(user);
		expect(data).toMatchObject({
			mode: 'forced',
			theme: 'advent',
			until: '2099-12-24T18:00',
			active: { id: 'advent', source: 'forced' },
			status: 'Active: Advent (forced until 24 Dec 2099, 18:00)'
		});
	});

	it('describes a forced theme without an end and the off switch', async () => {
		const { user } = await userWithSession('admin');
		await save(user, { mode: 'forced', theme: 'party', until: '' });
		expect((await loadAs(user)).status).toBe('Active: Party (forced)');
		await save(user, { mode: 'off' });
		expect(await loadAs(user)).toMatchObject({ active: null, status: 'Active: none (off)' });
	});

	it('refuses moderators', async () => {
		const { user } = await userWithSession('moderator');
		await expect(load({ locals: { user } } as never)).rejects.toMatchObject({ status: 403 });
	});
});
