import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const REQUIRED = {
	ORIGIN: 'http://localhost:5173',
	DATABASE_URL: 'postgres://loki:loki@localhost:5432/loki',
	S3_ENDPOINT: 'http://localhost:9000',
	S3_BUCKET: 'loki',
	S3_ACCESS_KEY_ID: 'minioadmin',
	S3_SECRET_ACCESS_KEY: 'minioadmin',
	OIDC_ISSUER: 'http://localhost:8080/loki',
	OIDC_CLIENT_ID: 'loki',
	OIDC_CLIENT_SECRET: 'secret'
};

describe('loadEnv', () => {
	let original: NodeJS.ProcessEnv;

	beforeEach(() => {
		original = process.env;
		process.env = { ...REQUIRED };
	});

	afterEach(() => {
		process.env = original;
	});

	it('returns a typed object with defaults applied', () => {
		const env = loadEnv();
		expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
		expect(env.S3_REGION).toBe('auto');
		expect(env.OIDC_GROUPS_CLAIM).toBe('groups');
		expect(env.OIDC_GROUP_MEMBERS).toBe('loki-members');
		expect(env.OIDC_GROUP_MODS).toBe('loki-mods');
		expect(env.OIDC_GROUP_ADMINS).toBe('loki-admins');
		expect(env.MAX_UPLOAD_MB).toBe(50);
		expect(env.AUTO_BLUR_SCORE).toBe(-3);
	});

	it('parses numeric overrides', () => {
		process.env.MAX_UPLOAD_MB = '10';
		process.env.AUTO_BLUR_SCORE = '-5';
		const env = loadEnv();
		expect(env.MAX_UPLOAD_MB).toBe(10);
		expect(env.AUTO_BLUR_SCORE).toBe(-5);
	});

	it('requires ORIGIN', () => {
		expect(loadEnv().ORIGIN).toBe(REQUIRED.ORIGIN);
		delete process.env.ORIGIN;
		expect(() => loadEnv()).toThrow(/ORIGIN/);
	});

	it('throws naming the missing variable', () => {
		delete process.env.DATABASE_URL;
		expect(() => loadEnv()).toThrow(/DATABASE_URL/);
	});

	it('lists all missing variables at once', () => {
		delete process.env.DATABASE_URL;
		delete process.env.S3_BUCKET;
		expect(() => loadEnv()).toThrow(/DATABASE_URL.*S3_BUCKET/s);
	});

	it('throws on non-numeric numeric values', () => {
		process.env.MAX_UPLOAD_MB = 'lots';
		expect(() => loadEnv()).toThrow(/MAX_UPLOAD_MB/);
	});
});
