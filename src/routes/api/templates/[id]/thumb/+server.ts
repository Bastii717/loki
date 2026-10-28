import { error } from '@sveltejs/kit';
import { imageResponse, parseId } from '../../../../../lib/server/image-stream';
import { getObject } from '../../../../../lib/server/storage';
import { getTemplate } from '../../../../../lib/server/templates';
import type { RequestHandler } from './$types';

/** The 320 px WebP thumbnail of a library template. */
export const GET: RequestHandler = async ({ params, locals }) => {
	// The global guard already blocks anonymous requests; this keeps the route safe on its own.
	if (!locals.user) error(401, 'Unauthorized');
	const template = await getTemplate(parseId(params.id));
	if (!template) error(404, 'Not found');
	const { body } = await getObject(template.thumbKey);
	return imageResponse(body, 'image/webp');
};
