// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SeasonId } from '$lib/seasons';
import type { SessionUser } from '$lib/server/auth/session';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: SessionUser | null;
			season: { id: SeasonId; source: 'auto' | 'forced' | 'preview' } | null;
		}
		// interface PageData {}
		interface PageState {
			/** Ordered public meme ids of the feed the detail view was opened from (swipe navigation). */
			feedIds?: string[];
		}
		// interface Platform {}
	}
}

export {};
