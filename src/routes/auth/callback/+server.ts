import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	NoAccessError,
	STATE_COOKIE,
	VERIFIER_COOKIE,
	client,
	getConfiguration,
	upsertUserFromClaims
} from '../../../lib/server/auth/oidc';
import {
	SESSION_COOKIE,
	SESSION_COOKIE_OPTIONS,
	createSession
} from '../../../lib/server/auth/session';
import type { SessionUser } from '../../../lib/server/auth/session';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const state = cookies.get(STATE_COOKIE);
	const verifier = cookies.get(VERIFIER_COOKIE);
	cookies.delete(STATE_COOKIE, { path: '/auth/callback' });
	cookies.delete(VERIFIER_COOKIE, { path: '/auth/callback' });
	if (!state || !verifier) redirect(303, '/login?error=failed');

	let user: SessionUser | null = null;
	let error = 'failed';
	try {
		const config = await getConfiguration();
		const tokens = await client.authorizationCodeGrant(config, url, {
			pkceCodeVerifier: verifier,
			expectedState: state
		});
		const claims = tokens.claims();
		if (claims) user = await upsertUserFromClaims(claims);
	} catch (err) {
		if (err instanceof NoAccessError) error = 'no_access';
		else console.error('OIDC callback failed', err);
	}
	if (!user) redirect(303, `/login?error=${error}`);

	cookies.set(SESSION_COOKIE, await createSession(user.id), SESSION_COOKIE_OPTIONS);
	redirect(303, '/');
};
