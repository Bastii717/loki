import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CommentComposer from './CommentComposer.svelte';

type Props = ComponentProps<typeof CommentComposer>;

function html(props: Partial<Props> = {}): string {
	return render(CommentComposer, {
		props: {
			mediaId: 'MemeAbc12345',
			label: 'Write a comment',
			locked: false,
			blocked: () => false,
			onposted: () => {},
			...props
		} as Props
	}).body;
}

const textarea = (body: string) => body.match(/<textarea\b[^>]*>/)?.[0] ?? '';

describe('CommentComposer', () => {
	it('is an ARIA combobox that controls a (closed) member listbox', () => {
		const body = html();
		const ta = textarea(body);
		expect(ta).toContain('role="combobox"');
		expect(ta).toContain('aria-expanded="false"');
		expect(ta).toContain('aria-autocomplete="list"');
		expect(ta).toContain('aria-label="Write a comment"');
		expect(ta).toContain('maxlength="2000"');
		expect(ta).not.toContain('aria-activedescendant');
		const controls = ta.match(/aria-controls="([^"]+)"/)?.[1];
		expect(controls).toBeTruthy();
		expect(body).toMatch(
			new RegExp(
				`<ul\\b[^>]*role="listbox"[^>]*id="${controls}"|<ul\\b[^>]*id="${controls}"[^>]*role="listbox"`
			)
		);
	});

	it('renders the initial text', () => {
		expect(html({ initialText: '@Lena K. ' })).toMatch(/<textarea\b[^>]*>@Lena K\. <\/textarea>/);
	});

	it('disables Send while empty', () => {
		expect(html()).toMatch(/<button\b[^>]*type="submit"[^>]*disabled/);
	});

	it('shows Cancel only for an inline reply composer', () => {
		expect(html()).not.toContain('>Cancel<');
		expect(html({ oncancel: () => {} })).toContain('>Cancel<');
	});

	it('marks Send as disabled with the reason while writes are locked', () => {
		const body = html({ locked: true, lockTitle: 'Maintenance', initialText: 'hi' });
		const send = body.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0] ?? '';
		expect(send).toContain('aria-disabled="true"');
		expect(send).toContain('title="Maintenance"');
	});

	it('says Save in edit mode and Send otherwise', () => {
		expect(html({ initialText: 'hi' })).toMatch(/<button\b[^>]*type="submit"[^>]*>Send<\/button>/);
		expect(html({ initialText: 'hi', editId: 'Cmt0Abc12345' })).toMatch(
			/<button\b[^>]*type="submit"[^>]*>Save<\/button>/
		);
	});
});
