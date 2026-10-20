/**
 * Takes the README screenshots into docs/screenshots/.
 *
 *   npx tsx --env-file=.env scripts/readme-screenshots.ts
 *
 * Needs the dev server on http://localhost:5173 (see .claude/agents/readme-screenshots.md),
 * the demo data from scripts/seed-demo.ts, and a local Chromium (`npx playwright install chromium`).
 * Signs in through the mock OIDC provider with a throwaway demo account.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import sharp from 'sharp';

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5173';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const MAX_BYTES = 600 * 1024;
// Not one of the seeded users, so the viewer's own votes do not skew the picture.
const DEMO_USERNAME = 'mia';
const DEMO_CLAIMS = JSON.stringify({ preferred_username: DEMO_USERNAME, groups: ['loki-members'] });

const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

type Profile = typeof MOBILE;

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const LOCAL_HOST = /^(localhost|127\.)/;

/**
 * Network policy for the browser:
 * - Anything that may live on the LAN (the OIDC provider, the media behind the S3 redirect) is fetched from this Node process instead of Chromium. On macOS,
 *   Chromium is often denied access to LAN hosts (local network privacy) while Node is not,
 *   and the request then hangs forever. Redirects are handed back to the browser so that
 *   every hop passes through here.
 * - Third-party hosts (the mock login page pulls a Google font) are blocked: no waiting, no leaks.
 */
async function routeRequest(route: Route): Promise<void> {
	const request = route.request();
	const { hostname, pathname } = new URL(request.url());
	if (!PRIVATE_HOST.test(hostname)) return route.abort();
	const viaNode =
		!LOCAL_HOST.test(hostname) ||
		request.resourceType() === 'document' ||
		pathname.startsWith('/media/');
	if (!viaNode) return route.continue();
	// The media route answers with a redirect to a presigned S3 URL: let Node follow it and hand
	// the browser the bytes. Everything else keeps its redirects for the browser to follow.
	const response = await route.fetch({ maxRedirects: pathname.startsWith('/media/') ? 5 : 0 });
	return route.fulfill({ response });
}

async function login(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`);
	await page.waitForURL('**/login**');
	await page.getByRole('button', { name: 'Mit Authentik anmelden' }).click();

	// navikt mock-oauth2-server: any username works; the claims field is optional.
	await page.waitForSelector('input[name="username"]');
	await page.fill('input[name="username"]', DEMO_USERNAME);
	await page.fill('textarea[name="claims"]', DEMO_CLAIMS);
	await page.locator('input[type="submit"]').click();

	await page.waitForURL(`${BASE_URL}/**`);
	await page.getByRole('navigation', { name: 'Hauptnavigation' }).waitFor();
}

/** Waits until every visible <img> is decoded and at least one is visible (no gray placeholders). */
async function waitForImages(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
	await page.locator('img').first().waitFor({ state: 'visible' });
	await page.waitForFunction(() => {
		// only what is on screen: images further down are lazy-loaded and never requested
		const imgs = [...document.images].filter((i) => {
			const r = i.getBoundingClientRect();
			return r.width > 0 && r.top < innerHeight && r.bottom > 0;
		});
		return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
	});
	await page.evaluate(() => document.fonts.ready);
	// let entry animations settle
	await page.waitForTimeout(400);
}

/** Saves a PNG, re-encoding it with sharp (palette quantisation) if it blows the size budget. */
async function save(name: string, png: Buffer): Promise<void> {
	let out = png;
	if (out.length > MAX_BYTES) {
		out = await sharp(png).png({ compressionLevel: 9, effort: 10 }).toBuffer();
	}
	if (out.length > MAX_BYTES) {
		out = await sharp(png).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
	}
	const meta = await sharp(out).metadata();
	await writeFile(join(OUT_DIR, name), out);
	const kb = (out.length / 1024).toFixed(0);
	const warn = out.length > MAX_BYTES ? '  WARNING: over the size budget' : '';
	console.log(`${name}: ${meta.width}x${meta.height}, ${kb} KB${warn}`);
}

async function withContext(
	browser: Browser,
	profile: Profile,
	run: (page: Page) => Promise<void>,
	mobile: boolean
): Promise<void> {
	const context = await browser.newContext({
		...profile,
		isMobile: mobile,
		hasTouch: mobile,
		locale: 'de-DE',
		timezoneId: 'Europe/Berlin',
		colorScheme: 'dark'
	});
	await context.route('**/*', routeRequest);
	try {
		const page = await context.newPage();
		if (process.env.SCREENSHOT_DEBUG) {
			page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()?.errorText));
			page.on('response', (r) => r.status() >= 300 && console.log(r.status(), r.url()));
		}
		await login(page);
		await run(page);
	} finally {
		await context.close();
	}
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	const browser = await chromium.launch();
	try {
		await withContext(
			browser,
			MOBILE,
			async (page) => {
				await page.goto(`${BASE_URL}/`);
				await waitForImages(page);
				await save('feed-mobile.png', await page.screenshot());

				// The meme with the most comments makes the best detail view.
				const link = await page.evaluate(async () => {
					const res = await fetch('/api/feed?sort=new');
					const { items } = await res.json();
					const best = [...items].sort((a, b) => b.commentCount - a.commentCount)[0];
					return `/meme/${best.id}`;
				});
				await page.goto(`${BASE_URL}${link}`);
				await page.getByText('Kommentare').first().waitFor();
				await waitForImages(page);
				await save('detail-mobile.png', await page.screenshot());
			},
			true
		);
		await withContext(
			browser,
			DESKTOP,
			async (page) => {
				await page.goto(`${BASE_URL}/`);
				await waitForImages(page);
				await save('feed-desktop.png', await page.screenshot());
			},
			false
		);
	} finally {
		await browser.close();
	}
}

await main();
