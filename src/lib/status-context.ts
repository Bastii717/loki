import { getContext } from 'svelte';
import type { StatusView } from './server/maintenance';

/** Svelte context key under which the root layout publishes the viewer's `StatusView`. */
export const STATUS_KEY = 'loki:status';

const WRITABLE: { readonly value: StatusView } = {
	value: { state: 'ok', message: null, writable: true }
};

/**
 * The current app status (reactive through `.value`). Without a layout above (component tests)
 * everything is writable.
 */
export function useStatus(): { readonly value: StatusView } {
	return getContext<{ readonly value: StatusView } | undefined>(STATUS_KEY) ?? WRITABLE;
}

/** The text for a locked control: the status message, or a generic line when there is none. */
export function lockMessage(status: StatusView): string {
	return status.message ?? 'Posting is paused right now.';
}
