import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { handle } from '../../hooks.server';

type Handler = (event: never) => unknown;

export interface RouteCall {
	handler: Handler;
	path: string;
	method?: string;
	params?: Record<string, string>;
	/** JSON request body. */
	body?: unknown;
	/** Value of the session cookie; omit for an anonymous request. */
	session?: string;
	/** Other request cookies (e.g. OIDC flow cookies). */
	cookies?: Record<string, string>;
}

export interface RouteResult {
	response: Response;
	/** Cookies the route set, by name. */
	set: Record<string, { value: string; options: Record<string, unknown> }>;
	deleted: string[];
}

/**
 * Runs a request through the real `handle` hook (auth guard, rate limits, security headers)
 * into `handler`, mirroring how SvelteKit turns thrown HttpErrors and redirects into responses.
 */
export async function callRoute(call: RouteCall): Promise<RouteResult> {
	const url = new URL(`https://loki.test${call.path}`);
	const jar = { loki_session: call.session, ...call.cookies } as Record<string, string | undefined>;
	const set: RouteResult['set'] = {};
	const deleted: string[] = [];
	const event = {
		url,
		request: new Request(url, {
			method: call.method ?? 'GET',
			headers: call.body === undefined ? undefined : { 'content-type': 'application/json' },
			body: call.body === undefined ? undefined : JSON.stringify(call.body)
		}),
		params: call.params ?? {},
		cookies: {
			get: (name: string) => jar[name],
			delete: (name: string) => void deleted.push(name),
			set: (name: string, value: string, options: Record<string, unknown>) =>
				void (set[name] = { value, options })
		},
		locals: {} as App.Locals,
		parent: async () => ({})
	} as unknown as RequestEvent;

	const resolve = (async (e: RequestEvent) => {
		try {
			const result = await call.handler(e as never);
			return result instanceof Response ? result : new Response(null, { status: 204 });
		} catch (err) {
			if (isHttpError(err)) return new Response(err.body.message, { status: err.status });
			if (isRedirect(err))
				return new Response(null, { status: err.status, headers: { location: err.location } });
			throw err;
		}
	}) as Parameters<Handle>[0]['resolve'];

	return { response: await handle({ event, resolve }), set, deleted };
}
