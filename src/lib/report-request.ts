/** The `fetch` arguments of `POST /api/report`; `contentId` is the public id of the meme, comment or quote. */
export function reportRequest(body: {
	contentType: 'meme' | 'comment' | 'quote';
	contentId: string;
	category: string;
	text: string;
}): [url: string, init: RequestInit] {
	return [
		'/api/report',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}
	];
}
