/**
 * The `/api/feed` URL of one infinite-scroll page of a profile list. `uploader` is the member's public
 * id (member page); `mine` and `favorites` need no id because the server uses the session.
 */
export function feedPageUrl(opts: {
	cursor: string;
	list: 'mine' | 'favorites' | 'user';
	uploader?: string;
}): string {
	const params = new URLSearchParams({ sort: 'new', cursor: opts.cursor });
	if (opts.list === 'user') params.set('uploader', opts.uploader ?? '');
	else params.set('list', opts.list);
	return `/api/feed?${params}`;
}
