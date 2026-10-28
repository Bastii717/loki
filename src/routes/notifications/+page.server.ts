import { redirect } from '@sveltejs/kit';
import { listNotifications, markAllRead, openNotification } from '../../lib/server/notifications';
import type { Actions, PageServerLoad } from './$types';

/** Largest id a `serial` column holds; anything above can never match and must not reach the query. */
const MAX_ID = 2_147_483_647;

/** A positive integer id from user input, else undefined. */
function parseId(raw: string | null): number | undefined {
	if (raw === null || !/^\d+$/.test(raw)) return undefined;
	const id = Number(raw);
	return id > 0 && id <= MAX_ID ? id : undefined;
}

// The hooks already require a session for this path, so there is no guard of its own.
export const load: PageServerLoad = async ({ locals, url, parent }) => {
	const user = locals.user!;
	const param = url.searchParams.get('filter');
	const filter = param === 'activity' || param === 'moderation' ? param : 'all';
	const { items, hasMore } = await listNotifications(user.id, {
		filter: filter === 'all' ? undefined : filter,
		before: parseId(url.searchParams.get('before'))
	});
	// the bell count comes from the root layout: one count per request, not two
	const { unreadNotifications } = (await parent()) as { unreadNotifications?: number };
	return { items, hasMore, filter, unread: unreadNotifications ?? 0 };
};

export const actions: Actions = {
	// Opening a notice is bookkeeping (it marks it read), so the write lock lets it through.
	open: async ({ locals, request }) => {
		const user = locals.user!;
		const data = await request.formData();
		const id = parseId(String(data.get('id') ?? ''));
		const target = id === undefined ? null : await openNotification(user.id, id);
		// a gone target keeps the filter the member was looking at
		const filter = String(data.get('filter') ?? '');
		const back =
			filter === 'activity' || filter === 'moderation'
				? `/notifications?filter=${filter}`
				: '/notifications';
		redirect(303, target === null || target === '/notifications' ? back : target);
	},

	readAll: async ({ locals }) => {
		await markAllRead(locals.user!.id);
		return { done: true };
	}
};
