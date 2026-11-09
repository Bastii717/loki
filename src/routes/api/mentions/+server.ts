import { error, json } from '@sveltejs/kit';
import { searchPeople } from '../../../lib/server/search';
import type { RequestHandler } from './$types';

const MAX_QUERY = 50;
const MAX_PEOPLE = 8;

/** Member picker for @mentions: board name only, never the username or role. */
export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (q === '') return json({ people: [] });
	if (q.length > MAX_QUERY) error(400, 'Query too long');
	const { items } = await searchPeople(false, q, { limit: MAX_PEOPLE, offset: 0 });
	return json({
		people: items.map((p) => ({ id: p.id, name: p.name, avatarThumbKey: p.avatarThumbKey }))
	});
};
