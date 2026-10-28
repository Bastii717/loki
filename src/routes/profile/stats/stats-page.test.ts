import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const PID = 'AbCdEfGhIjKl';

describe('profile stats page', () => {
	it('links the top-voted memes by public id and labels untitled ones "Untitled"', () => {
		const { body } = render(Page as never, {
			props: {
				data: {
					uploadsPerWeek: [],
					topUploaders: [],
					topVoted: [
						{ id: PID, title: 'Named', score: 9 },
						{ id: 'ZyXwVuTsRqPo', title: '', score: 4 }
					],
					topTags: []
				}
			} as never
		});
		expect(body).toContain(`/meme/${PID}`);
		expect(body).toContain('/meme/ZyXwVuTsRqPo');
		expect(body).toContain('>Untitled<');
		expect(body).not.toMatch(/Meme \d/);
	});
});
