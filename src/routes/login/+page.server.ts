import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	FLOW_COOKIE_OPTIONS,
	STATE_COOKIE,
	VERIFIER_COOKIE,
	client,
	getConfiguration,
	redirectUri
} from '../../lib/server/auth/oidc';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, '/');
	return { error: url.searchParams.get('error') };
};

export const actions: Actions = {
	default: async ({ cookies, url }) => {
		const config = await getConfiguration();
		const state = client.randomState();
		const verifier = client.randomPKCECodeVerifier();
		cookies.set(STATE_COOKIE, state, FLOW_COOKIE_OPTIONS);
		cookies.set(VERIFIER_COOKIE, verifier, FLOW_COOKIE_OPTIONS);

		const target = client.buildAuthorizationUrl(config, {
			redirect_uri: redirectUri(url),
			scope: 'openid profile groups',
			state,
			code_challenge: await client.calculatePKCECodeChallenge(verifier),
			code_challenge_method: 'S256'
		});
		redirect(303, target.href, { external: [target.origin] });
	}
};
