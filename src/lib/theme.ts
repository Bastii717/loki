export type Theme = 'light' | 'dark';

const KEY = 'loki-theme';

/** The theme currently in effect: the forced one, else the OS preference. */
export function currentTheme(): Theme {
	const forced = document.documentElement.dataset.theme;
	if (forced === 'light' || forced === 'dark') return forced;
	return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Forces `theme` on <html> and remembers it (storage may be unavailable, e.g. private mode). */
export function setTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme;
	try {
		localStorage.setItem(KEY, theme);
	} catch {
		// the choice then only lasts for this page view
	}
}
