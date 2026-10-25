import { eq } from 'drizzle-orm';
import { formatDateTime, formatTime } from '../moderation-labels';
import type { SessionUser } from './auth/session';
import { db } from './db';
import { maintenance } from './db/schema';
import { AUDIT_ACTIONS, audit } from './moderation';
import { getReadiness, type Readiness } from './readiness';

export type AppState = 'ok' | 'announced' | 'maintenance' | 'not_ready' | 'down';
type Role = SessionUser['role'];

export interface MaintenanceRow {
	enabled: boolean;
	message: string;
	startsAt: Date | null;
	until: Date | null;
}

export interface MaintenanceInput {
	enabled: boolean;
	message: string;
	startsAt: Date | null;
	until: Date | null;
}

export interface StatusView {
	state: AppState;
	message: string | null;
	writable: boolean;
}

export const MAX_MAINTENANCE_MESSAGE = 300;
const ROW_ID = 1;
const DEFAULT_MAINTENANCE_TEXT = 'Loki is under maintenance. Reading works, posting is paused.';
const NOT_READY_TEXT =
	'Loki is still starting up. Posting, voting and commenting are back in a moment.';
const ADMIN_ADDENDUM = 'You are an admin, so you can still post.';

/** Rejected setMaintenance input. The message is user-facing. */
export class MaintenanceInputError extends Error {}

const DEFAULT_ROW: MaintenanceRow = { enabled: false, message: '', startsAt: null, until: null };

async function loadRow(): Promise<MaintenanceRow> {
	const [row] = await db
		.select({
			enabled: maintenance.enabled,
			message: maintenance.message,
			startsAt: maintenance.startsAt,
			until: maintenance.until
		})
		.from(maintenance)
		.where(eq(maintenance.id, ROW_ID));
	return row ?? { ...DEFAULT_ROW };
}

let load: () => Promise<MaintenanceRow> = loadRow;
let clock: () => Date = () => new Date();

/** Test injection of the row loader and the clock. */
export function configureMaintenance(opts: {
	load?: () => Promise<MaintenanceRow>;
	now?: () => Date;
}): void {
	if (opts.load) load = opts.load;
	if (opts.now) clock = opts.now;
}

/** Restores the database loader and the real clock. */
export function resetMaintenance(): void {
	load = loadRow;
	clock = () => new Date();
}

/** The admin switch row (id 1); defaults when it was never saved. */
export function getMaintenance(): Promise<MaintenanceRow> {
	return load();
}

/** Saves the switch (upsert of row 1) and audits it in the same transaction. */
export async function setMaintenance(actor: SessionUser, input: MaintenanceInput): Promise<void> {
	if (input.message.length > MAX_MAINTENANCE_MESSAGE) {
		throw new MaintenanceInputError(
			`The message can have at most ${MAX_MAINTENANCE_MESSAGE} characters.`
		);
	}
	if (input.startsAt && input.until && input.until.getTime() <= input.startsAt.getTime()) {
		throw new MaintenanceInputError('The end must be after the start.');
	}
	const values = {
		enabled: input.enabled,
		message: input.message,
		startsAt: input.startsAt,
		until: input.until,
		updatedBy: actor.id,
		updatedAt: new Date()
	};
	const detail =
		`enabled=${input.enabled} message="${input.message}" ` +
		`starts=${input.startsAt?.toISOString() ?? 'none'} until=${input.until?.toISOString() ?? 'none'}`;
	await db.transaction(async (tx) => {
		await tx
			.insert(maintenance)
			.values({ id: ROW_ID, ...values })
			.onConflictDoUpdate({ target: maintenance.id, set: values });
		await audit(actor.id, AUDIT_ACTIONS.maintenanceChanged, 'maintenance', ROW_ID, detail, tx);
	});
}

/**
 * Precedence: down > not_ready > maintenance > announced > ok. A switch whose `until` has passed
 * has expired (ok); one whose `startsAt` is still ahead is only announced.
 */
export function resolveState(readiness: Readiness, row: MaintenanceRow, now: Date): AppState {
	if (!readiness.db || !readiness.migrated) return 'down';
	if (!readiness.storage) return 'not_ready';
	if (!row.enabled) return 'ok';
	if (row.until && row.until.getTime() <= now.getTime()) return 'ok';
	if (row.startsAt && row.startsAt.getTime() > now.getTime()) return 'announced';
	return 'maintenance';
}

/** Admins keep writing during maintenance; moderators count as members. */
export function canWrite(state: AppState, role: Role | null): boolean {
	if (state === 'ok' || state === 'announced') return true;
	if (state === 'maintenance') return role === 'admin';
	return false;
}

/** User-facing text for a state; null when there is nothing to say (`ok`, and `down`: the outage page has its own). */
export function statusMessage(
	state: AppState,
	row: MaintenanceRow,
	role: Role | null
): string | null {
	switch (state) {
		case 'maintenance': {
			let text = row.message.trim() || DEFAULT_MAINTENANCE_TEXT;
			if (row.until) text += ` Back around ${formatDateTime(row.until.toISOString())}.`;
			if (role === 'admin') text += ` ${ADMIN_ADDENDUM}`;
			return text;
		}
		case 'announced': {
			let text = 'Heads up: maintenance';
			if (row.startsAt) text += ` ${formatDateTime(row.startsAt.toISOString())}`;
			if (row.until) text += ` to ${formatTime(row.until.toISOString())}`;
			return `${text}. Reading will keep working.`;
		}
		case 'not_ready':
			return NOT_READY_TEXT;
		default:
			return null;
	}
}

/**
 * Combined state, text and write permission for the viewer. Never throws: if the switch cannot
 * be read (database error, table missing) the app is `down`.
 */
export async function currentStatus(user: SessionUser | null, now?: Date): Promise<StatusView> {
	const role = user?.role ?? null;
	const down: StatusView = { state: 'down', message: null, writable: false };
	const readiness = await getReadiness();
	if (!readiness.db || !readiness.migrated) return down;
	let row: MaintenanceRow;
	try {
		row = await getMaintenance();
	} catch {
		return down;
	}
	const state = resolveState(readiness, row, now ?? clock());
	return { state, message: statusMessage(state, row, role), writable: canWrite(state, role) };
}
