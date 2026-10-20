import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoter, optimisticVote, type VoteState } from './vote';

afterEach(() => vi.unstubAllGlobals());

function setup(initial: VoteState, fetchImpl: typeof fetch) {
	vi.stubGlobal('fetch', fetchImpl);
	let state = initial;
	const vote = createVoter(
		() => 7,
		() => state,
		(s) => {
			state = s;
		}
	);
	return { vote, get: () => state };
}

const ok = (body: VoteState) => Promise.resolve(Response.json(body));

describe('optimisticVote', () => {
	it('applies a fresh vote, switches direction and toggles off via 0', () => {
		expect(optimisticVote({ score: 3, userVote: 0 }, 1)).toEqual({ score: 4, userVote: 1 });
		expect(optimisticVote({ score: 3, userVote: 0 }, -1)).toEqual({ score: 2, userVote: -1 });
		expect(optimisticVote({ score: 4, userVote: 1 }, -1)).toEqual({ score: 2, userVote: -1 });
		expect(optimisticVote({ score: 4, userVote: 1 }, 1)).toEqual({ score: 3, userVote: 0 });
		expect(optimisticVote({ score: 2, userVote: -1 }, -1)).toEqual({ score: 3, userVote: 0 });
	});
});

describe('createVoter', () => {
	it('posts the new value, shows it optimistically and lets the server answer win', async () => {
		const fetchMock = vi.fn(() => ok({ score: 10, userVote: 1 }));
		const t = setup({ score: 3, userVote: 0 }, fetchMock as unknown as typeof fetch);
		const done = t.vote(1);
		expect(t.get()).toEqual({ score: 4, userVote: 1 }); // optimistic, before the response
		await done;
		expect(t.get()).toEqual({ score: 10, userVote: 1 }); // server wins
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/memes/7/vote');
		expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ value: 1 }) });
	});

	it('sends 0 when toggling the active vote off', async () => {
		const fetchMock = vi.fn(() => ok({ score: 3, userVote: 0 }));
		const t = setup({ score: 4, userVote: 1 }, fetchMock as unknown as typeof fetch);
		await t.vote(1);
		const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect(init.body).toBe(JSON.stringify({ value: 0 }));
	});

	it('rolls back on a non-OK response', async () => {
		const t = setup({ score: 3, userVote: 0 }, (() =>
			Promise.resolve(new Response('no', { status: 500 }))) as typeof fetch);
		await t.vote(1);
		expect(t.get()).toEqual({ score: 3, userVote: 0 });
	});

	it('rolls back when the request fails', async () => {
		const t = setup({ score: 3, userVote: -1 }, (() =>
			Promise.reject(new Error('offline'))) as typeof fetch);
		await t.vote(1);
		expect(t.get()).toEqual({ score: 3, userVote: -1 });
	});

	it('ignores clicks while a request is in flight, then accepts the next one', async () => {
		let release!: (r: Response) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((r) => {
					release = r;
				})
		);
		const t = setup({ score: 0, userVote: 0 }, fetchMock as unknown as typeof fetch);
		const first = t.vote(1);
		await t.vote(-1); // ignored
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(t.get()).toEqual({ score: 1, userVote: 1 });
		release(Response.json({ score: 1, userVote: 1 }));
		await first;
		fetchMock.mockImplementation(() => ok({ score: 0, userVote: 0 }));
		await t.vote(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(t.get()).toEqual({ score: 0, userVote: 0 });
	});
});
