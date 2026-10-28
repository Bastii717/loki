import { describe, expect, it } from 'vitest';
import { feedPageUrl } from './feed-request';

describe('feedPageUrl', () => {
	it('asks for a member page with uploader=<public id>', () => {
		expect(feedPageUrl({ cursor: 'abc', list: 'user', uploader: 'AbCdEfGh1234' })).toBe(
			'/api/feed?sort=new&cursor=abc&uploader=AbCdEfGh1234'
		);
	});

	it('names the own lists without an id', () => {
		expect(feedPageUrl({ cursor: 'abc', list: 'favorites' })).toBe(
			'/api/feed?sort=new&cursor=abc&list=favorites'
		);
		expect(feedPageUrl({ cursor: 'abc', list: 'mine' })).not.toContain('uploader');
	});
});
