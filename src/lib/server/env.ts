export interface Env {
	ORIGIN: string;
	DATABASE_URL: string;
	S3_ENDPOINT: string;
	S3_BUCKET: string;
	S3_ACCESS_KEY_ID: string;
	S3_SECRET_ACCESS_KEY: string;
	S3_REGION: string;
	S3_FORCE_PATH_STYLE: boolean;
	OIDC_ISSUER: string;
	OIDC_CLIENT_ID: string;
	OIDC_CLIENT_SECRET: string;
	OIDC_GROUPS_CLAIM: string;
	OIDC_GROUP_MEMBERS: string;
	OIDC_GROUP_MODS: string;
	OIDC_GROUP_ADMINS: string;
	MAX_UPLOAD_MB: number;
	AUTO_BLUR_SCORE: number;
	SESSION_ABSOLUTE_MAX_DAYS: number;
}

type RequiredName =
	| 'ORIGIN'
	| 'DATABASE_URL'
	| 'S3_ENDPOINT'
	| 'S3_BUCKET'
	| 'S3_ACCESS_KEY_ID'
	| 'S3_SECRET_ACCESS_KEY'
	| 'OIDC_ISSUER'
	| 'OIDC_CLIENT_ID'
	| 'OIDC_CLIENT_SECRET';

/** Parses and validates process.env. Throws listing every missing or invalid variable. */
export function loadEnv(): Env {
	const source = process.env;
	const problems: string[] = [];

	const required = (name: RequiredName): string => {
		const value = source[name];
		if (value === undefined || value === '') {
			problems.push(`${name} (missing)`);
			return '';
		}
		return value;
	};
	const optional = (name: string, fallback: string): string => {
		const value = source[name];
		return value === undefined || value === '' ? fallback : value;
	};
	const number = (name: string, fallback: number): number => {
		const raw = source[name];
		if (raw === undefined || raw === '') return fallback;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			problems.push(`${name} (not a number: "${raw}")`);
			return fallback;
		}
		return parsed;
	};

	const boolean = (name: string, fallback: boolean): boolean => {
		const raw = source[name];
		if (raw === undefined || raw === '') return fallback;
		if (raw === 'true') return true;
		if (raw === 'false') return false;
		problems.push(`${name} (not "true" or "false": "${raw}")`);
		return fallback;
	};

	const env: Env = {
		ORIGIN: required('ORIGIN'),
		DATABASE_URL: required('DATABASE_URL'),
		S3_ENDPOINT: required('S3_ENDPOINT'),
		S3_BUCKET: required('S3_BUCKET'),
		S3_ACCESS_KEY_ID: required('S3_ACCESS_KEY_ID'),
		S3_SECRET_ACCESS_KEY: required('S3_SECRET_ACCESS_KEY'),
		S3_REGION: optional('S3_REGION', 'auto'),
		S3_FORCE_PATH_STYLE: boolean('S3_FORCE_PATH_STYLE', true),
		OIDC_ISSUER: required('OIDC_ISSUER'),
		OIDC_CLIENT_ID: required('OIDC_CLIENT_ID'),
		OIDC_CLIENT_SECRET: required('OIDC_CLIENT_SECRET'),
		OIDC_GROUPS_CLAIM: optional('OIDC_GROUPS_CLAIM', 'groups'),
		OIDC_GROUP_MEMBERS: optional('OIDC_GROUP_MEMBERS', 'loki-members'),
		OIDC_GROUP_MODS: optional('OIDC_GROUP_MODS', 'loki-mods'),
		OIDC_GROUP_ADMINS: optional('OIDC_GROUP_ADMINS', 'loki-admins'),
		MAX_UPLOAD_MB: number('MAX_UPLOAD_MB', 50),
		AUTO_BLUR_SCORE: number('AUTO_BLUR_SCORE', -3),
		SESSION_ABSOLUTE_MAX_DAYS: number('SESSION_ABSOLUTE_MAX_DAYS', 90)
	};

	if (problems.length > 0) {
		throw new Error(`Invalid environment configuration: ${problems.join(', ')}`);
	}
	return env;
}

let cached: Env | undefined;

/** Lazily parsed singleton: validated on first property access, then reused. */
export const env: Env = new Proxy({} as Env, {
	get(_target, prop) {
		cached ??= loadEnv();
		return cached[prop as keyof Env];
	}
});
