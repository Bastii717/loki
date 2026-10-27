import type { RequestEvent } from '@sveltejs/kit';
import { seasonById, type SeasonId } from '../seasons';
import { currentSeason } from './seasons';

export interface RequestSeason {
	id: SeasonId;
	source: 'auto' | 'forced' | 'preview';
}

/**
 * The season for this request: an admin's `?season=<id>` preview (known ids only), otherwise
 * the active season (automatic window or forced), or null.
 */
export async function seasonForRequest(
	event: Pick<RequestEvent, 'url' | 'locals'>
): Promise<RequestSeason | null> {
	if (event.locals.user?.role === 'admin') {
		const requested = event.url.searchParams.get('season');
		const preview = requested ? seasonById(requested) : undefined;
		if (preview) return { id: preview.id, source: 'preview' };
	}
	return currentSeason();
}
