import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE_COOKIE, VERIFIER_COOKIE } from '../../../lib/server/auth/oidc';
import { db } from '../../../lib/server/db';
import { sessions, users } from '../../../lib/server/db/schema';
import { resetDb, setupDb } from '../../../lib/server/db/test-utils';
import { resetRateLimits } from '../../../lib/server/rate-limit';
import { callRoute } from '../../../lib/server/test-request';
import { GET } from './+server';

// Mock at the openid-client boundary: the discovery document and the code exchange. Everything
// else (cookies, claim mapping, user upsert, session creation) is the real code.
const authorizationCodeGrant = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/server/auth/oidc', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../lib/server/auth/oidc')>()),
	getConfiguration: async () => ({}),
	client: { authorizationCodeGrant }
}));

beforeAll(setupDb);
beforeEach(async () => {
	resetRateLimits();
	authorizationCodeGrant.mockReset();
	await resetDb();
});

afterEach(() => vi.restoreAllMocks());

const FLOW = { [STATE_COOKIE]: 'state-we-issued', [VERIFIER_COOKIE]: 'verifier' };

/** Like openid-client: rejects when the `state` on the callback URL is not the expected one. */
function exchangeReturning(claims: Record<string, unknown>) {
	authorizationCodeGrant.mockImplementation(
		async (_config: unknown, url: URL, checks: { expectedState: string }) => {
			if (url.searchParams.get('state') !== checks.expectedState) {
				throw new Error('unexpected JWT "state" claim value');
			}
			return { claims: () => claims };
		}
	);
}

const callback = (state: string, cookies: Record<string, string> = FLOW) =>
	callRoute({
		handler: GET,
		path: `/auth/callback?code=abc&state=${state}`,
		cookies
	});

const sessionRows = () => db.select().from(sessions);

describe('GET /auth/callback', () => {
	it('redirects a state mismatch to /login?error=failed and creates no session', async () => {
		exchangeReturning({ sub: 's1', preferred_username: 'alice', groups: ['loki-members'] });
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { response, set } = await callback('state-the-attacker-chose');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login?error=failed');
		expect(await sessionRows()).toHaveLength(0);
		expect(await db.select().from(users)).toHaveLength(0);
		expect(set.loki_session).toBeUndefined();
		// the exchange was asked to check the state we issued, not the one on the URL
		expect(authorizationCodeGrant.mock.calls[0][2]).toMatchObject({
			expectedState: 'state-we-issued',
			pkceCodeVerifier: 'verifier'
		});
	});

	it('redirects a user without any Loki group to /login?error=no_access and creates no session', async () => {
		exchangeReturning({ sub: 's2', preferred_username: 'bob', groups: ['other-app'] });
		const { response, set } = await callback('state-we-issued');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login?error=no_access');
		expect(await sessionRows()).toHaveLength(0);
		expect(await db.select().from(users)).toHaveLength(0);
		expect(set.loki_session).toBeUndefined();
	});

	it('also revokes the sessions of a returning user who lost access', async () => {
		exchangeReturning({ sub: 's3', preferred_username: 'carol', groups: ['loki-members'] });
		const ok = await callback('state-we-issued');
		expect(ok.response.headers.get('location')).toBe('/');
		expect(await sessionRows()).toHaveLength(1);

		exchangeReturning({ sub: 's3', preferred_username: 'carol', groups: [] });
		const denied = await callback('state-we-issued');
		expect(denied.response.headers.get('location')).toBe('/login?error=no_access');
		expect(await sessionRows()).toHaveLength(0);
	});

	it('redirects to /login?error=failed without the flow cookies, without calling the IdP', async () => {
		const { response } = await callback('state-we-issued', {});
		expect(response.headers.get('location')).toBe('/login?error=failed');
		expect(authorizationCodeGrant).not.toHaveBeenCalled();
		expect(await sessionRows()).toHaveLength(0);
	});

	it('logs in a valid callback: one session, cookie set, flow cookies cleared', async () => {
		exchangeReturning({ sub: 's4', preferred_username: 'dora', groups: ['loki-members'] });
		const { response, set, deleted } = await callback('state-we-issued');
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/');
		expect(await sessionRows()).toHaveLength(1);
		expect(set.loki_session?.value).toEqual(expect.any(String));
		expect(deleted).toEqual(expect.arrayContaining([STATE_COOKIE, VERIFIER_COOKIE]));
	});
});
