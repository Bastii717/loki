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
		expect(env.S3_FORCE_PATH_STYLE).toBe(true);
		expect(env.OIDC_GROUPS_CLAIM).toBe('groups');
		expect(env.OIDC_GROUP_MEMBERS).toBe('loki-members');
		expect(env.OIDC_GROUP_MODS).toBe('loki-mods');
		expect(env.OIDC_GROUP_ADMINS).toBe('loki-admins');
		expect(env.MAX_UPLOAD_MB).toBe(50);
		expect(env.AVATAR_MAX_MB).toBe(8);
		expect(env.AUTO_BLUR_SCORE).toBe(-3);
		expect(env.SESSION_ABSOLUTE_MAX_DAYS).toBe(90);
		expect(env.REPORT_REVIEW_THRESHOLD).toBe(3);
	});

	it('parses numeric overrides', () => {
		process.env.MAX_UPLOAD_MB = '10';
		process.env.AUTO_BLUR_SCORE = '-5';
		const env = loadEnv();
		expect(env.MAX_UPLOAD_MB).toBe(10);
		expect(env.AUTO_BLUR_SCORE).toBe(-5);
	});

	it('parses S3_FORCE_PATH_STYLE and rejects junk', () => {
		process.env.S3_FORCE_PATH_STYLE = 'false';
		expect(loadEnv().S3_FORCE_PATH_STYLE).toBe(false);
		process.env.S3_FORCE_PATH_STYLE = 'maybe';
		expect(() => loadEnv()).toThrow(/S3_FORCE_PATH_STYLE/);
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

	it.each(['0', '-1', '1.5'])('rejects AVATAR_MAX_MB=%s (positive integer required)', (value) => {
		process.env.AVATAR_MAX_MB = value;
		expect(() => loadEnv()).toThrow(/AVATAR_MAX_MB/);
	});

	it.each(['0', '-1', '1.5'])('rejects MAX_UPLOAD_MB=%s (positive integer required)', (value) => {
		process.env.MAX_UPLOAD_MB = value;
		expect(() => loadEnv()).toThrow(/MAX_UPLOAD_MB/);
	});

	it.each(['0', '-30', '0.5'])(
		'rejects SESSION_ABSOLUTE_MAX_DAYS=%s (would expire every session)',
		(value) => {
			process.env.SESSION_ABSOLUTE_MAX_DAYS = value;
			expect(() => loadEnv()).toThrow(/SESSION_ABSOLUTE_MAX_DAYS/);
		}
	);

	it('accepts 1 as the lower bound and keeps AUTO_BLUR_SCORE signed', () => {
		process.env.MAX_UPLOAD_MB = '1';
		process.env.SESSION_ABSOLUTE_MAX_DAYS = '1';
		process.env.AUTO_BLUR_SCORE = '-10';
		const env = loadEnv();
		expect([env.MAX_UPLOAD_MB, env.SESSION_ABSOLUTE_MAX_DAYS, env.AUTO_BLUR_SCORE]).toEqual([
			1, 1, -10
		]);
	});

	it.each(['0', '-1', '1.5', 'many'])(
		'rejects REPORT_REVIEW_THRESHOLD=%s (positive integer required)',
		(value) => {
			process.env.REPORT_REVIEW_THRESHOLD = value;
			expect(() => loadEnv()).toThrow(/REPORT_REVIEW_THRESHOLD/);
		}
	);

	it('parses REPORT_REVIEW_THRESHOLD and accepts 1 as the lower bound', () => {
		process.env.REPORT_REVIEW_THRESHOLD = '1';
		expect(loadEnv().REPORT_REVIEW_THRESHOLD).toBe(1);
		process.env.REPORT_REVIEW_THRESHOLD = '5';
		expect(loadEnv().REPORT_REVIEW_THRESHOLD).toBe(5);
	});

	describe('feedback mail', () => {
		it('defaults to disabled with SMTP defaults', () => {
			const env = loadEnv();
			expect(env.SMTP_HOST).toBeNull();
			expect(env.MAIL_FROM).toBeNull();
			expect(env.FEEDBACK_TO).toEqual([]);
			expect(env.SMTP_PORT).toBe(587);
			expect(env.SMTP_SECURE).toBe(false);
			expect(env.SMTP_REQUIRE_TLS).toBe(true);
			expect(env.SMTP_USER).toBe('');
			expect(env.SMTP_PASS).toBe('');
		});

		it('parses all three core variables, trimming the recipient list', () => {
			process.env.SMTP_HOST = 'smtp.example.test';
			process.env.MAIL_FROM = 'loki@example.test';
			process.env.FEEDBACK_TO = ' a@example.test, ,b@example.test ,';
			process.env.SMTP_PORT = '465';
			process.env.SMTP_SECURE = 'true';
			process.env.SMTP_USER = 'user';
			process.env.SMTP_PASS = 'pass';
			const env = loadEnv();
			expect(env.SMTP_HOST).toBe('smtp.example.test');
			expect(env.MAIL_FROM).toBe('loki@example.test');
			expect(env.FEEDBACK_TO).toEqual(['a@example.test', 'b@example.test']);
			expect(env.SMTP_PORT).toBe(465);
			expect(env.SMTP_SECURE).toBe(true);
			expect(env.SMTP_USER).toBe('user');
			expect(env.SMTP_PASS).toBe('pass');
		});

		it('parses SMTP_REQUIRE_TLS and rejects junk', () => {
			process.env.SMTP_REQUIRE_TLS = 'false';
			expect(loadEnv().SMTP_REQUIRE_TLS).toBe(false);
			process.env.SMTP_REQUIRE_TLS = 'maybe';
			expect(() => loadEnv()).toThrow(/SMTP_REQUIRE_TLS/);
		});

		it.each([
			{ SMTP_HOST: 'smtp.example.test' },
			{ MAIL_FROM: 'loki@example.test' },
			{ FEEDBACK_TO: 'a@example.test' },
			{ SMTP_HOST: 'smtp.example.test', MAIL_FROM: 'loki@example.test' },
			{ FEEDBACK_TO: ' , ', MAIL_FROM: 'loki@example.test', SMTP_HOST: 'smtp.example.test' }
		])('rejects a partial setup %j', (partial) => {
			Object.assign(process.env, partial);
			expect(() => loadEnv()).toThrow(/SMTP_HOST.*MAIL_FROM.*FEEDBACK_TO.*all three.*or none/s);
		});
	});
});
