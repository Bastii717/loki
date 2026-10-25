import { apiErrorMessage } from './api-error';

export type VoteValue = -1 | 0 | 1;
export type VoteState = { score: number; userVote: VoteValue };

/** State after clicking `dir`: clicking the active direction again clears the vote (toggle via 0). */
export function optimisticVote(state: VoteState, dir: 1 | -1): VoteState {
	const next = state.userVote === dir ? 0 : dir;
	return { score: state.score + next - state.userVote, userVote: next };
}

/**
 * Shared optimistic voting for the meme views. Returns the click handler: it applies the
 * optimistic state right away, POSTs it, lets the server's answer win, and rolls back on any
 * failure. A click while a request is in flight is ignored.
 *
 * `read`/`write` bridge to the component's own reactive state; `memeId` is a getter so the
 * current id is used at click time. `onError` gets the user-facing text of a rejected vote (the
 * maintenance notice of a 503, the timeout notice of a 403), other failures roll back silently.
 */
export function createVoter(
	memeId: () => number,
	read: () => VoteState,
	write: (state: VoteState) => void,
	onError?: (message: string) => void
): (dir: 1 | -1) => Promise<void> {
	let inFlight = false;
	return async (dir) => {
		if (inFlight) return;
		inFlight = true;
		const prev = read();
		const next = optimisticVote(prev, dir);
		write(next);
		try {
			const res = await fetch(`/api/memes/${memeId()}/vote`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ value: next.userVote })
			});
			if (!res.ok) {
				write(prev);
				const message = await apiErrorMessage(res, '');
				if (message) onError?.(message);
				return;
			}
			write((await res.json()) as VoteState);
		} catch {
			write(prev);
		} finally {
			inFlight = false;
		}
	};
}
