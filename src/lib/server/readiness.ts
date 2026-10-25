import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { client } from './db';
import { env } from './env';
import { s3Client } from './storage';

export interface Readiness {
	db: boolean;
	migrated: boolean;
	storage: boolean;
	checkedAt: Date;
}

const DB_TIMEOUT_MS = 2_000;
const STORAGE_TIMEOUT_MS = 3_000;
const DEFAULT_TTL_MS = 10_000;
const PROBE_KEY = '.loki-readiness-probe';

/** Storage is reachable when the bucket answers: a missing probe object (404) is the expected case. */
export function classifyStorageOutcome(outcome: { status?: number; errorName?: string }): boolean {
	const { status, errorName } = outcome;
	if (status !== undefined && status >= 200 && status < 300) return true;
	return status === 404 || errorName === 'NotFound';
}

async function probeDb(): Promise<boolean> {
	const query = client`select 1`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			query,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('db probe timed out')), DB_TIMEOUT_MS);
			})
		]);
		return true;
	} catch {
		try {
			query.cancel();
		} catch {
			// nothing left to cancel
		}
		return false;
	} finally {
		clearTimeout(timer);
	}
}

async function probeStorage(): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// the abort signal asks the SDK to give up; the race is the hard bound if it never does
		const result = await Promise.race([
			s3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: PROBE_KEY }), {
				abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS)
			}),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('storage probe timed out')), STORAGE_TIMEOUT_MS);
			})
		]);
		return classifyStorageOutcome({ status: result.$metadata.httpStatusCode });
	} catch (e) {
		const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
		return classifyStorageOutcome({ status: err.$metadata?.httpStatusCode, errorName: err.name });
	} finally {
		clearTimeout(timer);
	}
}

type Probe = () => Promise<boolean>;
type Probed = Omit<Readiness, 'migrated'>;

let dbProbe: Probe = probeDb;
let storageProbe: Probe = probeStorage;
let now: () => number = Date.now;
let ttlMs = DEFAULT_TTL_MS;

let migrated = false;
let cache: { value?: Probed; promise?: Promise<void> } = {};

/**
 * Records whether the boot migrations have succeeded. Applied live, never cached. `init` owns it
 * in production and `setupDb()` in tests.
 */
export function setMigrated(ok: boolean): void {
	migrated = ok;
}

/** Test injection; clears the cache. */
export function configureReadiness(opts: {
	dbProbe?: Probe;
	storageProbe?: Probe;
	now?: () => number;
	ttlMs?: number;
}): void {
	if (opts.dbProbe) dbProbe = opts.dbProbe;
	if (opts.storageProbe) storageProbe = opts.storageProbe;
	if (opts.now) now = opts.now;
	if (opts.ttlMs !== undefined) ttlMs = opts.ttlMs;
	cache = {};
}

/** Restores the default probes, clock and TTL, and clears the cache. */
export function resetReadiness(): void {
	dbProbe = probeDb;
	storageProbe = probeStorage;
	now = Date.now;
	ttlMs = DEFAULT_TTL_MS;
	cache = {};
}

/** A probe never throws: any failure, with whatever message it carries, is just `false`. */
async function safely(probe: Probe): Promise<boolean> {
	try {
		return (await probe()) === true;
	} catch {
		return false;
	}
}

function refresh(): void {
	const current = cache;
	const promise: Promise<void> = (async () => {
		const [db, storage] = await Promise.all([safely(dbProbe), safely(storageProbe)]);
		current.value = { db, storage, checkedAt: new Date(now()) };
	})().finally(() => {
		if (current.promise === promise) current.promise = undefined;
	});
	current.promise = promise;
}

/**
 * Cached readiness of the database, the migrations and the object storage. Probes run at most
 * once per TTL and concurrent callers share the run. Once a result exists it is served
 * immediately (stale while a refresh runs), so a hung dependency never blocks a request.
 */
export async function getReadiness(): Promise<Readiness> {
	const current = cache;
	const fresh = current.value !== undefined && now() - current.value.checkedAt.getTime() < ttlMs;
	if (!fresh && !current.promise) refresh();
	if (!current.value) await current.promise;
	const probed = current.value ?? { db: false, storage: false, checkedAt: new Date(now()) };
	return { ...probed, migrated };
}
