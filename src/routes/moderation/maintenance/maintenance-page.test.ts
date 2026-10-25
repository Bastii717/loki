import { desc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../lib/server/db';
import { auditLog } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { getMaintenance } from '../../../lib/server/maintenance';
import { userWithSession } from '../../../lib/server/moderation-test-utils';
import { ensureBucket } from '../../../lib/server/storage-test-utils';
import { actions, load } from './+page.server';

beforeAll(async () => {
	await setupDb();
	await ensureBucket(); // the load probes storage readiness
});
beforeEach(resetDb);

type Result = { status: number; data: { error: string } } | { saved: true };

async function save(
	user: Awaited<ReturnType<typeof userWithSession>>['user'],
	fields: Record<string, string>
) {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	const request = new Request('https://loki.test/moderation/maintenance', {
		method: 'POST',
		body
	});
	return (await actions.default({ request, locals: { user } } as never)) as Result;
}

const audits = () =>
	db
		.select()
		.from(auditLog)
		.where(eq(auditLog.action, 'maintenance_changed'))
		.orderBy(desc(auditLog.id));

describe('save action', () => {
	it('stores the switch with Berlin times converted to UTC, trims the message and audits once', async () => {
		const { user } = await userWithSession('admin');
		const result = await save(user, {
			enabled: 'on',
			message: '  Database upgrade  ',
			startsAt: '2026-07-01T12:00',
			until: '2026-07-01T14:30'
		});
		expect(result).toEqual({ saved: true });
		expect(await getMaintenance()).toEqual({
			enabled: true,
			message: 'Database upgrade',
			startsAt: new Date('2026-07-01T10:00:00Z'),
			until: new Date('2026-07-01T12:30:00Z')
		});
		const rows = await audits();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorId: user.id,
			targetType: 'maintenance',
			targetId: 1,
			detail:
				'enabled=true message="Database upgrade" starts=2026-07-01T10:00:00.000Z until=2026-07-01T12:30:00.000Z'
		});
	});

	it('treats a missing checkbox as off and empty times as none', async () => {
		const { user } = await userWithSession('admin');
		await save(user, { enabled: 'on', message: 'x', startsAt: '', until: '' });
		await save(user, { message: '   ', startsAt: '', until: '' });
		expect(await getMaintenance()).toEqual({
			enabled: false,
			message: '',
			startsAt: null,
			until: null
		});
		expect(await audits()).toHaveLength(2);
	});

	it('rejects an end before the start and saves nothing', async () => {
		const { user } = await userWithSession('admin');
		const result = await save(user, {
			enabled: 'on',
			message: 'Hi',
			startsAt: '2026-12-01T12:00',
			until: '2026-12-01T11:00'
		});
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'The end must be after the start.', message: 'Hi', enabled: true }
		});
		expect((await getMaintenance()).enabled).toBe(false);
		expect(await audits()).toHaveLength(0);
	});

	it('rejects a message of 301 characters and accepts 300', async () => {
		const { user } = await userWithSession('admin');
		const fields = { enabled: 'on', startsAt: '', until: '' };
		expect(await save(user, { ...fields, message: 'a'.repeat(301) })).toMatchObject({
			status: 400,
			data: { error: 'The message can have at most 300 characters.' }
		});
		expect(await audits()).toHaveLength(0);
		expect(await save(user, { ...fields, message: 'a'.repeat(300) })).toEqual({ saved: true });
	});

	it('rejects a malformed date', async () => {
		const { user } = await userWithSession('admin');
		const result = await save(user, { enabled: 'on', message: '', startsAt: 'soon', until: '' });
		expect(result).toMatchObject({ status: 400, data: { error: 'Enter a valid date and time.' } });
		expect(await audits()).toHaveLength(0);
	});

	it('refuses moderators', async () => {
		const { user } = await userWithSession('moderator');
		await expect(save(user, { enabled: 'on' })).rejects.toMatchObject({ status: 403 });
		expect(await audits()).toHaveLength(0);
	});
});

describe('off action', () => {
	it('clears the switch and audits it', async () => {
		const { user } = await userWithSession('admin');
		await save(user, {
			enabled: 'on',
			message: 'Hi',
			startsAt: '2026-07-01T12:00',
			until: '2026-07-01T14:00'
		});
		const result = await actions.off({ locals: { user } } as never);
		expect(result).toEqual({ saved: true });
		expect(await getMaintenance()).toEqual({
			enabled: false,
			message: '',
			startsAt: null,
			until: null
		});
		const rows = await audits();
		expect(rows).toHaveLength(2);
		expect(rows[0].detail).toBe('enabled=false message="" starts=none until=none');
	});

	it('refuses moderators', async () => {
		const { user } = await userWithSession('moderator');
		await expect(actions.off({ locals: { user } } as never)).rejects.toMatchObject({ status: 403 });
	});
});

describe('load', () => {
	it('prefills Berlin local times and previews both variants', async () => {
		const { user } = await userWithSession('admin');
		await save(user, {
			enabled: 'on',
			message: 'Database upgrade',
			startsAt: '2020-07-01T12:00',
			until: '2099-12-01T12:00'
		});
		const data = (await load({ locals: { user } } as never)) as {
			enabled: boolean;
			message: string;
			startsAt: string;
			until: string;
			state: string;
			preview: { admin: string; member: string };
		};
		expect(data).toMatchObject({
			enabled: true,
			message: 'Database upgrade',
			startsAt: '2020-07-01T12:00',
			until: '2099-12-01T12:00',
			state: 'maintenance'
		});
		expect(data.preview.member).toBe('Database upgrade Back around 1 Dec 2099, 12:00.');
		expect(data.preview.admin).toBe(
			`${data.preview.member} You are an admin, so you can still post.`
		);
	});

	it('refuses moderators', async () => {
		const { user } = await userWithSession('moderator');
		await expect(load({ locals: { user } } as never)).rejects.toMatchObject({ status: 403 });
	});
});
