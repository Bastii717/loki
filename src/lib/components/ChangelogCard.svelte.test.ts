import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogEntry } from '../changelog';
import ChangelogCard from './ChangelogCard.svelte';

const KEY = 'loki.changelog.dismissed';
const entry: ChangelogEntry = { id: 'v2.0.0', lines: ['First thing.', 'Second thing.'] };

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

function show(props: { entry?: ChangelogEntry | null } = { entry }) {
	app = mount(ChangelogCard, { target, props });
	flushSync();
}

beforeEach(() => {
	localStorage.clear();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (app) unmount(app);
	app = undefined;
	target.remove();
	vi.restoreAllMocks();
});

describe('ChangelogCard', () => {
	it('renders nothing without an entry', () => {
		show({ entry: null });
		expect(target.querySelector('.changelog')).toBeNull();
	});

	it('shows title, every line and a dismiss button on a fresh browser', () => {
		show();
		expect(target.querySelector('.title')?.textContent).toBe('New in Loki');
		const items = [...target.querySelectorAll('li')].map((li) => li.textContent);
		expect(items).toEqual(['First thing.', 'Second thing.']);
		expect(target.querySelector('button')?.getAttribute('aria-label')).toBe('Dismiss');
	});

	it('hides on dismiss and remembers the id', () => {
		show();
		target.querySelector('button')!.click();
		flushSync();
		expect(target.querySelector('.changelog')).toBeNull();
		expect(localStorage.getItem(KEY)).toBe('v2.0.0');
	});

	it('stays hidden when the current id was dismissed', () => {
		localStorage.setItem(KEY, 'v2.0.0');
		show();
		expect(target.querySelector('.changelog')).toBeNull();
	});

	it('shows again when only an older id was dismissed', () => {
		localStorage.setItem(KEY, 'v1.9.0');
		show();
		expect(target.querySelector('.changelog')).not.toBeNull();
	});

	it('shows when localStorage throws, and dismissing does not crash', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		show();
		expect(target.querySelector('.changelog')).not.toBeNull();
		target.querySelector('button')!.click();
		flushSync();
		expect(target.querySelector('.changelog')).toBeNull();
	});
});
