import { describe, expect, it } from 'vitest';
import {
	encodeMentions,
	MAX_MENTIONS,
	mentionIds,
	mentionQuery,
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

	it('encodeMentions ignores picks with an empty or blank name', () => {
		expect(
			encodeMentions('@ hi @Lena', [
				{ id: 'aaaaaaaaaaaa', name: '' },
				{ id: 'bbbbbbbbbbbb', name: '   ' }
			])
		).toBe('@ hi @Lena');
	});

	it('encodeMentions does not match a picked name at the start of a longer typed name', () => {
		const lena = [{ id: 'aaaaaaaaaaaa', name: 'Lena' }];
		expect(encodeMentions('@Lena Kowalski and @Lenara and @Lena2 and @Lena_k', lena)).toBe(
			'@[u:aaaaaaaaaaaa] Kowalski and @Lenara and @Lena2 and @Lena_k'
		);
		expect(encodeMentions('@Lenä', lena)).toBe('@Lenä');
	});

	it('encodeMentions matches before end of text, whitespace and punctuation', () => {
		const lena = [{ id: 'aaaaaaaaaaaa', name: 'Lena' }];
		const t = mentionToken('aaaaaaaaaaaa');
		expect(encodeMentions('@Lena', lena)).toBe(t);
		expect(encodeMentions('@Lena, @Lena! (@Lena) @Lena\nok', lena)).toBe(
			`${t}, ${t}! (${t}) ${t}\nok`
		);
		expect(encodeMentions("@Lena's", lena)).toBe(`${t}'s`);
	});

	it('encodeMentions treats regex characters in names literally', () => {
		expect(encodeMentions('@a.b and @axb', [{ id: 'aaaaaaaaaaaa', name: 'a.b' }])).toBe(
			'@[u:aaaaaaaaaaaa] and @axb'
		);
	});
});

describe('mentionQuery', () => {
	it('finds the query after an @ at a word boundary', () => {
		expect(mentionQuery('hi @Le')).toEqual({ start: 3, q: 'Le' });
	});

	it('spans a second word, so multi-word names can be narrowed', () => {
		expect(mentionQuery('@Lena K')).toEqual({ start: 0, q: 'Lena K' });
	});

	it('keeps the query open on a trailing space after the first word', () => {
		expect(mentionQuery('@Lena ')).toEqual({ start: 0, q: 'Lena ' });
	});

	it('ends after a space following the second word (as after a pick)', () => {
		expect(mentionQuery('@Lena K. ')).toBeNull();
	});

	it('needs whitespace or the start before the @', () => {
		expect(mentionQuery('a@b')).toBeNull();
	});

	it('ends at a third word', () => {
		expect(mentionQuery('@Lena thanks everyone')).toBeNull();
	});

	it('gives up beyond 50 characters', () => {
		expect(mentionQuery(`@${'a'.repeat(50)}`)).toEqual({ start: 0, q: 'a'.repeat(50) });
		expect(mentionQuery(`@${'a'.repeat(25)} ${'b'.repeat(25)}`)).toBeNull();
		expect(mentionQuery(`@${'a'.repeat(51)}`)).toBeNull();
	});
});
