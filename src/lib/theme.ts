export type Theme = 'light' | 'dark';

const KEY = 'loki-theme';

/** The theme currently in effect: the forced one, else the OS preference. */
export function currentTheme(): Theme {
	const forced = document.documentElement.dataset.theme;
	if (forced === 'light' || forced === 'dark') return forced;
	return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Points `<meta name="theme-color">` (browser chrome / PWA status bar) at the active theme's --bg. */
export function syncThemeColor(): void {
	const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
	if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

/**
 * Keeps the theme-color meta right on load and while following the OS preference (no forced
 * theme). Returns the cleanup function.
 */
export function watchThemeColor(): () => void {
	syncThemeColor();
	const query = matchMedia('(prefers-color-scheme: light)');
	query.addEventListener('change', syncThemeColor);
	return () => query.removeEventListener('change', syncThemeColor);
}

/** Forces `theme` on <html> and remembers it (storage may be unavailable, e.g. private mode). */
export function setTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme;
	syncThemeColor();
	try {
		localStorage.setItem(KEY, theme);
	} catch {
		// the choice then only lasts for this page view
	}
}
