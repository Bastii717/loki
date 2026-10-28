import { error } from '@sveltejs/kit';
import { takeShared } from '../../../lib/server/share-stash';
import type { RequestHandler } from './$types';

/** Hands the stashed shared file to the upload page, once. */
export const GET: RequestHandler = ({ locals }) => {
	const file = takeShared(locals.user!.id);
	if (!file) error(404, 'Nothing shared');
	const headers: Record<string, string> = {
		'content-type': file.type, // sniffed at stash time, never client-declared
		'x-content-type-options': 'nosniff',
		'content-security-policy': 'sandbox',
		'x-shared-name': encodeURIComponent(file.name),
		'cache-control': 'no-store'
	};
	// meme generator hand-over: prefilled title and the template the meme was made from
	// toWellFormed: encodeURIComponent throws on a lone surrogate, and the stash is already consumed
	if (file.title) headers['x-shared-title'] = encodeURIComponent(file.title.toWellFormed());
	if (file.templateId !== undefined) headers['x-shared-template'] = file.templateId;
	if (file.nsfw) headers['x-shared-nsfw'] = '1';
	if (file.spoiler) headers['x-shared-spoiler'] = '1';
	return new Response(new Uint8Array(file.data), { headers });
};
