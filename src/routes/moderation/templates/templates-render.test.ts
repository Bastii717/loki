import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const template = (over: Record<string, unknown> = {}) => ({
	id: 7,
	name: 'Drake',
	objectKey: 'templates/a.webp',
	thumbKey: 'templates/a-320.webp',
	width: 1200,
	height: 600,
	usageCount: 0,
	removedAt: null,
	...over
});

const renderPage = (data: Record<string, unknown>, form: unknown = null) =>
	render(Page as never, {
		props: { data: { templates: [], removed: [], ...data }, form } as never
	});

const html = (data: Record<string, unknown>, form: unknown = null) => renderPage(data, form).body;
const head = (data: Record<string, unknown>) => renderPage(data).head;

describe('templates page', () => {
	it('has the title, the heading and the add form', () => {
		const body = html({});
		expect(body).toMatch(/<h1[^>]*>Templates<\/h1>/);
		expect(head({})).toContain('<title>Templates · Loki</title>');
		expect(body).toMatch(/<form[^>]*action="\?\/add"/);
		expect(body).toContain('enctype="multipart/form-data"');
		expect(body).toContain('accept="image/jpeg,image/png,image/webp"');
		expect(body).toMatch(
			/<input[^>]*name="name"[^>]*maxlength="60"[^>]*required|<input[^>]*maxlength="60"[^>]*name="name"/
		);
		expect(body).toContain('Add template');
	});

	it('shows the empty state without templates and no Removed group', () => {
		const body = html({});
		expect(body).toContain('No templates yet. Add the first one above.');
		expect(body).not.toContain('Removed (');
	});

	it('shows a card per template with the thumbnail scaled into a 96 px box', () => {
		const body = html({
			templates: [template(), template({ id: 8, name: 'Doge', width: 300, height: 600 })]
		});
		expect(body).not.toContain('No templates yet');
		expect(body).toMatch(/<img[^>]*src="\/api\/templates\/7\/thumb"/);
		expect(body).toMatch(/<img[^>]*src="\/api\/templates\/8\/thumb"/);
		// 1200x600 -> 96x48, 300x600 -> 48x96
		expect(body).toMatch(
			/<img[^>]*src="\/api\/templates\/7\/thumb"[^>]*width="96"[^>]*height="48"/
		);
		expect(body).toMatch(
			/<img[^>]*src="\/api\/templates\/8\/thumb"[^>]*width="48"[^>]*height="96"/
		);
		expect(body).toContain('alt=""');
		expect(body).toContain('Drake');
		expect(body).toContain('Doge');
	});

	it('words the usage count', () => {
		const body = html({
			templates: [
				template({ id: 1, name: 'A', usageCount: 3 }),
				template({ id: 2, name: 'B', usageCount: 1 }),
				template({ id: 3, name: 'C', usageCount: 0 })
			]
		});
		expect(body).toContain('Used 3 times');
		expect(body).toContain('Used once');
		expect(body).toContain('Not used yet');
	});

	it('offers Rename (prefilled) and Remove per active template', () => {
		const body = html({ templates: [template()] });
		expect(body).toMatch(/<form[^>]*action="\?\/rename"/);
		expect(body).toMatch(/<form[^>]*action="\?\/remove"/);
		expect(body).toMatch(/name="id"[^>]*value="7"/);
		expect(body).toMatch(/name="name"[^>]*value="Drake"/);
		expect(body).toContain('Save');
		expect(body).toContain('Remove');
	});

	it('lists removed templates in a collapsed group with Restore', () => {
		const body = html({
			templates: [template()],
			removed: [template({ id: 9, name: 'Old one', removedAt: '2026-10-01T10:00:00.000Z' })]
		});
		expect(body).toMatch(/<details[ >]/);
		expect(body).not.toMatch(/<details[^>]*\sopen/);
		expect(body).toContain('Removed (1)');
		expect(body).toContain('Old one');
		expect(body).toMatch(/<form[^>]*action="\?\/restore"/);
		expect(body).toContain('Restore');
	});

	it('shows the removed group even when no template is active', () => {
		const body = html({
			removed: [template({ id: 9, name: 'Old one', removedAt: '2026-10-01T10:00:00.000Z' })]
		});
		expect(body).toContain('No templates yet. Add the first one above.');
		expect(body).toContain('Removed (1)');
	});

	it('shows an action error as an alert', () => {
		const body = html({}, { error: 'Pick an image first.' });
		expect(body).toMatch(/<p class="error" role="alert">Pick an image first\.<\/p>/);
		expect(html({})).not.toContain('role="alert"');
	});
});
