import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { TemplateRow } from '../../lib/server/templates';
import Editor from './Editor.svelte';
import Page from './+page.svelte';

const tpl = (id: number, name: string): TemplateRow => ({
	id,
	name,
	objectKey: `templates/${id}.webp`,
	thumbKey: `templates/${id}-320.webp`,
	width: 640,
	height: 480,
	usageCount: 0,
	removedAt: null
});

const html = (data: Record<string, unknown>) =>
	render(Page, { props: { data, form: null } as never }).body;

const gridData = (templates: TemplateRow[]) => ({ mode: 'grid', templates });

const editorData = (kind: 'template' | 'meme') => ({
	mode: kind,
	source: {
		kind,
		id: 5,
		name: 'Drake',
		width: 640,
		height: 480,
		url: kind === 'template' ? '/api/templates/5/image' : '/api/memes/5/source'
	}
});

describe('create page: template grid', () => {
	it('renders a two-column grid of template cards', () => {
		const out = html(gridData([tpl(3, 'Drake'), tpl(4, 'Distracted boyfriend')]));
		expect(out).toContain('Pick a template');
		expect(out).toMatch(/<ul class="[^"]*\bgrid\b/);
		expect(out).toContain('href="/create?template=3"');
		expect(out).toContain('href="/create?template=4"');
		expect(out).toContain('src="/api/templates/3/thumb"');
		expect(out).toMatch(/<img[^>]*src="\/api\/templates\/3\/thumb"[^>]*alt=""/);
		expect(out).toContain('width="640"');
		expect(out).toContain('height="480"');
		expect(out).toContain('Drake');
		expect(out).toContain('Distracted boyfriend');
	});

	it('shows the remix hint below the grid', () => {
		const out = html(gridData([tpl(3, 'Drake')]));
		expect(out).toMatch(/<p class="[^"]*\bhint\b[^"]*">Or open any meme and tap Remix\.<\/p>/);
		expect(out.indexOf('</ul>')).toBeLessThan(out.indexOf('Or open any meme'));
	});

	it('shows the empty state without templates', () => {
		const out = html(gridData([]));
		expect(out).toContain('No templates yet. Admins add them under Moderation → Templates.');
		expect(out).not.toContain('class="grid"');
	});

	it('has the page title', () => {
		const { head } = render(Page, { props: { data: gridData([]), form: null } as never });
		expect(head).toContain('<title>Make a meme · Loki</title>');
	});
});

describe('create page: editor', () => {
	it('renders the canvas, both caption fields and counters', () => {
		const out = html(editorData('template'));
		expect(out).toContain('<canvas');
		expect(out).toMatch(/<textarea[^>]*name="top"[^>]*maxlength="100"/);
		expect(out).toMatch(/<textarea[^>]*name="bottom"[^>]*maxlength="100"/);
		expect(out).toContain('Top text');
		expect(out).toContain('Bottom text');
		expect(out.match(/0\/100/g)).toHaveLength(2);
	});

	it('does not size the canvas from the stored dimensions before the image loads', () => {
		const out = html({
			...editorData('template'),
			source: { ...editorData('template').source, width: 4000, height: 3000 }
		});
		expect(out).toMatch(/<canvas[^>]*style="[^"]*aspect-ratio:\s*4000 \/ 3000/);
		const canvas = out.match(/<canvas[^>]*>/)![0];
		expect(canvas).not.toMatch(/\swidth=/);
		expect(canvas).not.toMatch(/\sheight=/);
	});

	it('uses the stored size as the aspect-ratio placeholder', () => {
		const out = html(editorData('template'));
		expect(out).toMatch(/<canvas[^>]*style="[^"]*aspect-ratio:\s*640 \/ 480/);
	});

	it('limits the preview height so the fields stay reachable', () => {
		const source = readFileSync(new URL('./Editor.svelte', import.meta.url), 'utf8');
		const canvasRule = source.match(/canvas\s*\{[^}]*\}/)![0];
		expect(canvasRule).toContain('max-height: 60vh');
		expect(canvasRule).toMatch(/width:\s*auto/);
		expect(canvasRule).toContain('max-width: 100%');
		expect(canvasRule).toContain('margin-inline: auto');
	});

	it('derives the title from the top text with collapsed whitespace', () => {
		const out = render(Editor, {
			props: { source: editorData('template').source, form: null, top: 'a   b\n c' } as never
		}).body;
		expect(out).toMatch(/<input[^>]*type="hidden"[^>]*name="title"[^>]*value="a b c"/);
	});

	it('caps the title at 120 characters', () => {
		const out = render(Editor, {
			props: { source: editorData('template').source, form: null, top: 'x'.repeat(300) } as never
		}).body;
		expect(out).toContain(`name="title" value="${'x'.repeat(120)}"`);
	});

	it('has UPPERCASE checked by default', () => {
		const out = html(editorData('template'));
		expect(out).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
		expect(out).toContain('UPPERCASE');
	});

	it('disables Post it until the image and font are ready', () => {
		const out = html(editorData('template'));
		expect(out).toMatch(/<button[^>]*disabled[^>]*>\s*Post it\s*<\/button>/);
	});

	it('posts to the stash action as multipart form data', () => {
		const out = html(editorData('template'));
		expect(out).toMatch(/<form[^>]*method="POST"/);
		expect(out).toContain('action="?/stash"');
		expect(out).toContain('enctype="multipart/form-data"');
	});

	it('carries the template id for a template source', () => {
		const out = html(editorData('template'));
		expect(out).toMatch(/<input[^>]*type="hidden"[^>]*name="templateId"[^>]*value="5"/);
	});

	it('carries no template id for a meme source', () => {
		const out = html(editorData('meme'));
		expect(out).not.toContain('name="templateId"');
		expect(out).toContain('name="title"');
	});

	it('links back to the template grid', () => {
		const out = html(editorData('template'));
		expect(out).toMatch(/<a href="\/create"[^>]*>[^<]*Change template/);
	});

	it('shows the action error', () => {
		const out = render(Page, {
			props: { data: editorData('template'), form: { error: 'Posting is not wired yet.' } } as never
		}).body;
		expect(out).toContain('Posting is not wired yet.');
	});
});

describe('create page: keyed editor', () => {
	const withSource = (id: number, name: string) => ({
		mode: 'template',
		source: {
			kind: 'template',
			id,
			name,
			width: 640,
			height: 480,
			url: `/api/templates/${id}/image`
		}
	});

	it('renders a different editor for each source', () => {
		const a = html(withSource(5, 'Drake'));
		const b = html(withSource(9, 'Distracted boyfriend'));
		expect(a).toMatch(/name="templateId"[^>]*value="5"/);
		expect(b).toMatch(/name="templateId"[^>]*value="9"/);
		expect(a).toContain('aria-label="Preview of Drake"');
		expect(b).toContain('aria-label="Preview of Distracted boyfriend"');
		expect(a).not.toEqual(b);
	});

	it('renders no grid markup in editor mode', () => {
		const out = html(withSource(5, 'Drake'));
		expect(out).not.toMatch(/class="[^"]*\bgrid\b/);
		expect(out).not.toContain('Pick a template');
		expect(out).toContain('<canvas');
	});
});
