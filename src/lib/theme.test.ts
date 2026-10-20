import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTheme, syncThemeColor } from './theme';

const BG = { dark: '#111214', light: '#f2f3f5' } as const;

let meta: { content: string; setAttribute: (name: string, value: string) => void };
let root: { dataset: Record<string, string> };

beforeEach(() => {
	meta = {
		content: BG.dark,
		setAttribute(name, value) {
			if (name === 'content') this.content = value;
		}
	};
	root = { dataset: {} };
	vi.stubGlobal('document', {
		documentElement: root,
		querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null)
	});
	// the --bg token resolves from the forced theme, like the real stylesheet
	vi.stubGlobal('getComputedStyle', () => ({
		getPropertyValue: (name: string) =>
			name === '--bg' ? ` ${root.dataset.theme === 'light' ? BG.light : BG.dark} ` : ''
	}));
	vi.stubGlobal('localStorage', { setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('theme-color meta', () => {
	it('follows the toggle in both directions', () => {
		setTheme('light');
		expect(meta.content).toBe(BG.light);
		setTheme('dark');
		expect(meta.content).toBe(BG.dark);
	});

	it('syncs to the active theme on load', () => {
		root.dataset.theme = 'light'; // restored from storage by the inline script in app.html
		syncThemeColor();
		expect(meta.content).toBe(BG.light);
	});

	it('leaves the meta alone when the token cannot be resolved', () => {
		vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
		syncThemeColor();
		expect(meta.content).toBe(BG.dark);
	});
});
