import { describe, expect, it } from 'vitest';
import { highlight } from './search-view';

describe('highlight', () => {
	it('splits around the first case-insensitive match and keeps the original casing', () => {
		expect(highlight('Stand-up at nine, STAND-UP again', 'stand-up')).toEqual({
			before: '',
			match: 'Stand-up',
			after: ' at nine, STAND-UP again'
		});
	});

	it('keeps the text before and after', () => {
		expect(highlight('the weekly meeting notes', 'meeting')).toEqual({
			before: 'the weekly ',
			match: 'meeting',
			after: ' notes'
		});
	});

	it('is null when the needle does not occur (a typo match)', () => {
		expect(highlight('the weekly meeting', 'metting')).toBeNull();
	});

	it('is null for an empty needle', () => {
		expect(highlight('anything', '')).toBeNull();
	});

	it('treats regex characters literally', () => {
		expect(highlight('cost is 5+5 (really)', '5+5 (')).toEqual({
			before: 'cost is ',
			match: '5+5 (',
			after: 'really)'
		});
		expect(highlight('abc', 'a.c')).toBeNull();
	});
});
