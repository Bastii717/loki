import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

type Item = {
	id: number;
	kind: string;
	actor: { name: string; avatarThumbKey: string | null } | null;
	contentType: string | null;
	mediaId: number | null;
	title: string | null;
	detail: string;
	count: number;
	read: boolean;
	updatedAt: string;
};

const item = (over: Partial<Item> = {}): Item => ({
	id: 1,
	kind: 'comment',
	actor: { name: 'Lena K', avatarThumbKey: null },
	contentType: null,
	mediaId: 7,
	title: 'Cat',
	detail: 'lol',
	count: 1,
	read: false,
	updatedAt: '2026-10-28T10:00:00.000Z',
	...over
});

const data = (over: Record<string, unknown> = {}) => ({
	items: [] as Item[],
	hasMore: false,
	filter: 'all',
	unread: 0,
	...over
});

const renderPage = (d: Record<string, unknown>) =>
	render(Page as never, { props: { data: d, form: null } as never });
const html = (d: Record<string, unknown>) => renderPage(d).body;

/** The `<li>` rows of the list, each up to its closing tag. */
const rows = (body: string) => [...body.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);

describe('notifications page', () => {
	it('has the title and heading', () => {
		const out = renderPage(data());
		expect(out.head).toContain('<title>Notifications · Loki</title>');
		expect(out.body).toMatch(/<h1[^>]*>Notifications<\/h1>/);
	});

	it('links a gear to the notification preferences', () => {
		expect(html(data())).toMatch(
			/<a[^>]*href="\/profile\/notifications"[^>]*aria-label="Notification settings"[^>]*>[\s\S]*?lucide-settings/
		);
	});

	it('shows an unread activity row with the activity icon and the actor avatar', () => {
		const [row] = rows(html(data({ items: [item()], unread: 1 })));
		expect(row).toMatch(/^<li[^>]*class="[^"]*\bunread\b/);
		expect(row).toMatch(/^<li[^>]*class="[^"]*\bactivity\b/);
		expect(row).not.toMatch(/^<li[^>]*class="[^"]*\bmoderation\b/);
		expect(row).toContain('lucide-message-circle');
		expect(row).toContain('Lena K commented on your meme');
		// a letter circle: the actor has no picture
		expect(row).toMatch(/class="avatar letter[ "]/);
	});

	it('shows a read row without the unread class', () => {
		const [row] = rows(html(data({ items: [item({ read: true })] })));
		expect(row).toMatch(/^<li[^>]*class="[^"]*\bactivity\b/);
		expect(row).not.toMatch(/^<li[^>]*class="[^"]*\bunread\b/);
	});

	it('marks a moderation row with the warn edge class and the shield, without an avatar', () => {
		const [row] = rows(
			html(
				data({
					items: [item({ id: 2, kind: 'timeout_lifted', actor: null, mediaId: null, read: true })]
				})
			)
		);
		expect(row).toMatch(/^<li[^>]*class="[^"]*\bmoderation\b/);
		expect(row).not.toMatch(/^<li[^>]*class="[^"]*\bactivity\b/);
		expect(row).toContain('lucide-shield');
		expect(row).not.toMatch(/class="avatar[ "]/);
		expect(row).toContain('Your timeout was lifted early.');
	});

	it('shows the excerpt of a thread comment on its own quoted line', () => {
		const [row] = rows(
			html(data({ items: [item({ kind: 'thread_comment', detail: 'me too', count: 1 })] }))
		);
		expect(row).toMatch(/<[a-z]+[^>]*class="[^"]*\bexcerpt\b[^"]*"[^>]*>“me too”<\/[a-z]+>/);
		expect(row).toContain('Lena K also commented on “Cat”');
	});

	it('posts every row to ?/open with its id', () => {
		const body = html(data({ items: [item({ id: 11 }), item({ id: 12, read: true })] }));
		const forms = [...body.matchAll(/<form[^>]*action="\?\/open"[\s\S]*?<\/form>/g)].map(
			(m) => m[0]
		);
		expect(forms).toHaveLength(2);
		expect(forms[0]).toMatch(/name="id"[^>]*value="11"/);
		expect(forms[1]).toMatch(/name="id"[^>]*value="12"/);
		for (const form of forms) {
			expect(form).toMatch(/method="POST"/i);
			expect(form.match(/<button/g)).toHaveLength(1);
			expect(form).toContain('type="submit"');
		}
	});

	it('carries the current filter in a hidden field of every row form', () => {
		const body = html(data({ items: [item({ id: 11 })], filter: 'moderation' }));
		const form = /<form[^>]*action="\?\/open"[\s\S]*?<\/form>/.exec(body)![0];
		expect(form).toMatch(/name="filter"[^>]*value="moderation"/);
	});

	it('shows the Mark all as read button only when something is unread', () => {
		const some = html(data({ items: [item()], unread: 3 }));
		expect(some).toMatch(/<form[^>]*action="\?\/readAll"/);
		expect(some).toContain('Mark all as read');
		const none = html(data({ items: [item({ read: true })], unread: 0 }));
		expect(none).not.toContain('?/readAll');
		expect(none).not.toContain('Mark all as read');
	});

	it('has the spec empty states: one for All and Activity, one for Moderation', () => {
		const DEFAULT = 'Nothing here yet. When someone comments on your memes, you will know.';
		const MODERATION = 'No moderation notices. Keep it that way.';
		expect(html(data())).toContain(DEFAULT);
		expect(html(data({ filter: 'activity' }))).toContain(DEFAULT);
		const moderation = html(data({ filter: 'moderation' }));
		expect(moderation).toContain(MODERATION);
		expect(moderation).not.toContain(DEFAULT);
		expect(html(data({ items: [item()] }))).not.toContain(DEFAULT);
	});

	it('labels an unread row for screen readers and leaves a read row without the label', () => {
		const [unread] = rows(html(data({ items: [item()], unread: 1 })));
		expect(unread).toMatch(/<span class="sr-only[^"]*">Unread<\/span>/);
		const [read] = rows(html(data({ items: [item({ read: true })] })));
		expect(read).not.toContain('Unread');
	});

	it('renders the filter chips as links and marks the active one', () => {
		const body = html(data({ filter: 'moderation' }));
		expect(body).toMatch(/<a[^>]*href="\/notifications"[^>]*>\s*All/);
		expect(body).toMatch(/<a[^>]*href="\/notifications\?filter=activity"[^>]*>\s*Activity/);
		const active = [...body.matchAll(/<a[^>]*aria-current="page"[^>]*>[\s\S]*?<\/a>/g)].map(
			(m) => m[0]
		);
		expect(active).toHaveLength(1);
		expect(active[0]).toContain('Moderation');
	});

	it('links Show older to the last row and keeps the filter', () => {
		const items = [item({ id: 30 }), item({ id: 29 })];
		const older = html(data({ items, hasMore: true }));
		expect(older).toMatch(/<a[^>]*href="\/notifications\?before=29"[^>]*>\s*Show older/);
		const filtered = html(data({ items, hasMore: true, filter: 'activity' }));
		expect(filtered).toMatch(
			/<a[^>]*href="\/notifications\?filter=activity&(?:amp;)?before=29"[^>]*>\s*Show older/
		);
		expect(html(data({ items }))).not.toContain('Show older');
	});
});
