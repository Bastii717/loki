import { describe, expect, it } from 'vitest';
import {
	encodeMentions,
	MAX_MENTIONS,
	mentionIds,
	mentionToken,
	renderMentionsPlain,
	splitMentions
} from './mentions';

describe('mentions', () => {
	it('caps at five', () => expect(MAX_MENTIONS).toBe(5));

	it('builds a token', () => expect(mentionToken('aaaaaaaaaaaa')).toBe('@[u:aaaaaaaaaaaa]'));

	it('mentionIds returns distinct ids in first-seen order', () => {
		expect(mentionIds('hi @[u:aaaaaaaaaaaa] @[u:bbbbbbbbbbbb] @[u:aaaaaaaaaaaa]')).toEqual([
			'aaaaaaaaaaaa',
			'bbbbbbbbbbbb'
		]);
	});

	it('mentionIds ignores malformed tokens and plain @names', () => {
		expect(mentionIds('@[u:short] @Lena')).toEqual([]);
	});

	it('splitMentions splits text and mentions', () => {
		expect(splitMentions('a @[u:aaaaaaaaaaaa]!')).toEqual([
			{ kind: 'text', text: 'a ' },
			{ kind: 'mention', id: 'aaaaaaaaaaaa' },
			{ kind: 'text', text: '!' }
		]);
	});

	it('renderMentionsPlain substitutes names and falls back for unknown ids', () => {
		expect(
			renderMentionsPlain('hi @[u:aaaaaaaaaaaa] and @[u:bbbbbbbbbbbb]', {
				aaaaaaaaaaaa: 'Lena K.'
			})
		).toBe('hi @Lena K. and @unknown member');
	});

	it('encodeMentions converts picked names to tokens only', () => {
		expect(
			encodeMentions('hey @Lena K. and @Lena', [{ id: 'aaaaaaaaaaaa', name: 'Lena K.' }])
		).toBe('hey @[u:aaaaaaaaaaaa] and @Lena');
	});

	it('encodeMentions prefers the longer name', () => {
		expect(
			encodeMentions('@Lena K. hi', [
				{ id: 'aaaaaaaaaaaa', name: 'Lena' },
				{ id: 'bbbbbbbbbbbb', name: 'Lena K.' }
			])
		).toBe('@[u:bbbbbbbbbbbb] hi');
	});
});
