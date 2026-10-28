/**
 * Takes the README screenshots into docs/screenshots/.
 *
 *   npx tsx --env-file=.env scripts/readme-screenshots.ts
 *
 * Needs the dev server on http://localhost:5173 (see .claude/agents/readme-screenshots.md),
 * the demo data from scripts/seed-demo.ts, and a local Chromium (`npx playwright install chromium`).
 * Signs in through the mock OIDC provider: as a throwaway account for most shots, as the seeded
 * demo user `lena` for the profile pages (the throwaway account has no memes to show). The admin
 * account also supplies the moderator badge: it comments once on the detail meme.
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

interface Account {
	/** The OIDC `sub`, typed into the mock provider's username field. */
	sub: string;
	username: string;
	/** Group claims; the dev stack maps loki-members, loki-mods and loki-admins to the three roles. */
	groups: string[];
}

const MEMBERS = ['loki-members'];
const THROWAWAY: Account = { sub: DEMO_USERNAME, username: DEMO_USERNAME, groups: MEMBERS };
// The moderation area needs a moderator or admin; every other shot is taken as a plain member.
const ADMIN: Account = { ...THROWAWAY, groups: [...MEMBERS, 'loki-admins'] };
// The maintenance shot needs an admin and a plain member at the same time. The role is rewritten
// from the groups on every login, so the viewer must be a different user than ADMIN.
const MEMBER_VIEWER: Account = { sub: 'noah', username: 'noah', groups: MEMBERS };
// Profile pages need a user with memes, favorites and comments: the seeded `lena`.
const OWNER: Account = { sub: 'demo-lena', username: 'lena', groups: MEMBERS };

async function login(page: Page, account: Account): Promise<void> {
	await page.goto(`${BASE_URL}/`);
	await page.waitForURL('**/login**');
	await page.getByRole('button', { name: 'Sign in with Authentik' }).click();

	// navikt mock-oauth2-server: any username works; the claims field is optional.
	await page.waitForSelector('input[name="username"]');
	await page.fill('input[name="username"]', account.sub);
	await page.fill(
		'textarea[name="claims"]',
		JSON.stringify({ preferred_username: account.username, groups: account.groups })
	);
	await page.locator('input[type="submit"]').click();

	await page.waitForURL(`${BASE_URL}/**`);
	await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
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

interface ContextOptions {
	mobile: boolean;
	colorScheme?: 'dark' | 'light';
	account?: Account;
}

async function withContext(
	browser: Browser,
	profile: Profile,
	run: (page: Page) => Promise<void>,
	{ mobile, colorScheme = 'dark', account = THROWAWAY }: ContextOptions
): Promise<void> {
	const context = await browser.newContext({
		...profile,
		isMobile: mobile,
		hasTouch: mobile,
		locale: 'en-GB',
		timezoneId: 'Europe/Berlin',
		colorScheme
	});
	await context.route('**/*', routeRequest);
	try {
		const page = await context.newPage();
		if (process.env.SCREENSHOT_DEBUG) {
			page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()?.errorText));
			page.on('response', (r) => r.status() >= 300 && console.log(r.status(), r.url()));
		}
		await login(page, account);
		await run(page);
	} finally {
		await context.close();
	}
}

/** `--only=feed-desktop,detail-mobile` retakes just those shots (default: all). */
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const wants = (name: string) => !only || only.split(',').includes(name);

/** Whether any of the named shots is wanted. */
const wantsAny = (...names: string[]) => names.some(wants);

type FeedItem = { id: number; commentCount: number; thumbUrl: string };

/** The feed as the API serves it (newest first), fetched with the page's session. */
function feedItems(page: Page): Promise<FeedItem[]> {
	return page.evaluate(async () => {
		const res = await fetch('/api/feed?sort=new');
		return (await res.json()).items;
	});
}

/** The meme with the most comments makes the best detail view. */
async function shootDetail(page: Page, name: string): Promise<void> {
	const items = await feedItems(page);
	const best = [...items].sort((a, b) => b.commentCount - a.commentCount)[0];
	await page.goto(`${BASE_URL}/meme/${best.id}`);
	await page.getByText('Comments').first().waitFor();
	await waitForImages(page);
	await save(name, await page.screenshot());
}

const MOD_COMMENT = 'Approved by the mods.';

/**
 * The detail view with a role badge on a comment: the signed-in admin comments once on the same
 * meme the detail shots use (skipped when the comment is already there), then the page is scrolled
 * to the comment list.
 */
async function shootDetailBadges(page: Page, name: string): Promise<void> {
	const items = await feedItems(page);
	const best = [...items].sort((a, b) => b.commentCount - a.commentCount)[0];
	await page.goto(`${BASE_URL}/meme/${best.id}`);
	await page.getByText('Comments').first().waitFor();
	await page.waitForLoadState('networkidle');
	if ((await page.getByText(MOD_COMMENT).count()) === 0) {
		await page.getByLabel('Write a comment').fill(MOD_COMMENT);
		await page.getByRole('button', { name: 'Send' }).click();
		await page.getByText(MOD_COMMENT).first().waitFor();
	}
	await waitForImages(page);
	// bring the comment list up under the header so every comment and its badge is on screen
	await page.getByRole('heading', { name: /^Comments/ }).evaluate((el) => {
		el.scrollIntoView({ block: 'start' });
	});
	await page.waitForTimeout(400);
	await save(name, await page.screenshot());
}

/** The upload form with a picture, a title and two tags filled in (nothing is submitted). */
async function shootUpload(page: Page): Promise<void> {
	const [first] = await feedItems(page);
	const thumb = await page.request.get(`${BASE_URL}${first.thumbUrl}`);
	const png = await sharp(await thumb.body())
		.png()
		.toBuffer();
	await page.goto(`${BASE_URL}/upload`);
	// the change handler is only attached once the page has hydrated
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(500);
	await page.setInputFiles('input[type=file][name=file]', {
		name: 'meme.png',
		mimeType: 'image/png',
		buffer: png
	});
	await page.locator('img[alt="Preview"]').waitFor();
	await page.fill('input[name=title]', 'Code review says: LGTM');
	for (const tag of ['codereview', 'office']) {
		await page.fill('#tag-input', tag);
		await page.press('#tag-input', 'Enter');
	}
	await waitForImages(page);
	await save('upload-mobile.png', await page.screenshot());
}

/** The report dialog on the first feed card, with a reason picked and a note typed (not sent). */
async function shootReportDialog(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`);
	await waitForImages(page);
	await page.getByRole('button', { name: 'Report' }).first().click();
	const dialog = page.getByRole('dialog');
	await dialog.waitFor();
	await dialog.getByLabel('Misinformation & nonsense').check();
	await dialog.getByLabel('Note (optional)').fill('Prod was down because of a DNS change.');
	await page.waitForTimeout(300);
	await save('report-dialog-mobile.png', await page.screenshot());
}

/** A plain page: waits for a piece of text that proves the data is in, then shoots. */
async function shootPage(page: Page, path: string, name: string, ready: string): Promise<void> {
	await page.goto(`${BASE_URL}${path}`);
	await page.getByText(ready).first().waitFor();
	await page.waitForLoadState('networkidle');
	// avatars and other on-screen images must be decoded (a page without images passes at once)
	await page.waitForFunction(() =>
		[...document.images]
			.filter((i) => {
				const r = i.getBoundingClientRect();
				return r.width > 0 && r.top < innerHeight && r.bottom > 0;
			})
			.every((i) => i.complete && i.naturalWidth > 0)
	);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(400);
	await save(name, await page.screenshot());
}

/**
 * The admin user list, scrolled to the seeded `lena` (the one demo account with a real avatar),
 * so the cards below her show a letter avatar, the admin's own badge and the rename tools.
 */
async function shootUsers(page: Page, name: string): Promise<void> {
	await page.goto(`${BASE_URL}/moderation/users`);
	await page.getByText('All users').first().waitFor();
	await page.waitForLoadState('networkidle');
	await page.waitForFunction(() =>
		[...document.images].every((i) => i.complete && i.naturalWidth > 0)
	);
	await page.evaluate(() => document.fonts.ready);
	await page
		.getByText(`(${OWNER.username})`)
		.first()
		.evaluate((el) => {
			el.scrollIntoView({ block: 'start' });
			// leave room for the sticky header above her card
			for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
				if (p.scrollHeight > p.clientHeight && getComputedStyle(p).overflowY !== 'visible') {
					p.scrollTop -= 90;
					return;
				}
			}
			window.scrollBy(0, -90);
		});
	await page.waitForTimeout(400);
	await save(name, await page.screenshot());
}

async function shootQueue(page: Page, name: string): Promise<void> {
	await page.goto(`${BASE_URL}/moderation`);
	// the reporter's note sits in a collapsed <details>: open it so the reason shows
	await page.getByText('Reporters (1)').click();
	await page.getByText('DNS change').first().waitFor();
	await waitForImages(page);
	await save(name, await page.screenshot());
}

const MAINTENANCE_MESSAGE = 'Deploy in progress, back around 18:30';

/** Posts a maintenance form action as the signed-in admin and fails loudly if it is not accepted. */
async function maintenanceAction(
	page: Page,
	action: 'save' | 'off',
	form: Record<string, string> = {}
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/moderation/maintenance?/${action}`, {
		form,
		headers: { 'x-sveltekit-action': 'true' }
	});
	const body = await response.json().catch(() => null);
	if (!response.ok() || body?.type !== 'success')
		throw new Error(`maintenance ?/${action} failed: ${response.status()} ${JSON.stringify(body)}`);
}

/**
 * The feed with the maintenance banner: an admin switches maintenance on, a plain member takes
 * the shot (no admin addendum), and the switch is always turned off again.
 */
async function shootMaintenance(browser: Browser): Promise<void> {
	await withContext(
		browser,
		MOBILE,
		async (admin) => {
			await maintenanceAction(admin, 'save', { enabled: 'on', message: MAINTENANCE_MESSAGE });
			try {
				await withContext(
					browser,
					MOBILE,
					async (page) => {
						await page.goto(`${BASE_URL}/`);
						await page.getByText(MAINTENANCE_MESSAGE).first().waitFor();
						await waitForImages(page);
						await save('maintenance-mobile.png', await page.screenshot());
					},
					{ mobile: true, account: MEMBER_VIEWER }
				);
			} finally {
				await maintenanceAction(admin, 'off');
			}
		},
		{ mobile: true, account: ADMIN }
	);
}

/** The season form fields of `/moderation/theme` (the `until` value is a Berlin `datetime-local`). */
interface SeasonForm {
	mode: 'off' | 'auto' | 'forced';
	theme: string;
	until: string;
}

/** What the admin page currently shows, so the run can put exactly that back afterwards. */
async function readSeasons(browser: Browser): Promise<SeasonForm> {
	let current: SeasonForm | undefined;
	await withContext(
		browser,
		MOBILE,
		async (admin) => {
			await admin.goto(`${BASE_URL}/moderation/theme`);
			const mode = await admin.locator('input[name="mode"]:checked').inputValue();
			if (mode !== 'off' && mode !== 'auto' && mode !== 'forced')
				throw new Error(`unknown season mode ${mode}`);
			current = {
				mode,
				theme: await admin.locator('select[name="theme"]').inputValue(),
				until: await admin.locator('input[name="until"]').inputValue()
			};
		},
		{ mobile: true, account: ADMIN }
	);
	return current!;
}

/**
 * Sets the seasonal themes as an admin. Event themes follow the calendar (Halloween, Advent,
 * Carnival), so the run switches them off first (otherwise the shots would change colour around
 * those dates) and restores the mode it found. The Halloween shot uses the request-scoped
 * `?season=` preview, which still works.
 */
async function setSeasons(browser: Browser, form: SeasonForm): Promise<void> {
	await withContext(
		browser,
		MOBILE,
		async (admin) => {
			const response = await admin.request.post(`${BASE_URL}/moderation/theme?/save`, {
				form: { ...form },
				headers: { 'x-sveltekit-action': 'true' }
			});
			const body = await response.json().catch(() => null);
			if (!response.ok() || body?.type !== 'success')
				throw new Error(
					`season mode ${form.mode} failed: ${response.status()} ${JSON.stringify(body)}`
				);
		},
		{ mobile: true, account: ADMIN }
	);
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	const browser = await chromium.launch();
	let previous: SeasonForm | undefined;
	try {
		previous = await readSeasons(browser);
		await setSeasons(browser, { mode: 'off', theme: '', until: '' });
		if (
			wantsAny(
				'feed-mobile',
				'detail-mobile',
				'discover-mobile',
				'quotes-mobile',
				'upload-mobile',
				'report-dialog-mobile'
			)
		)
			await withContext(
				browser,
				MOBILE,
				async (page) => {
					if (wants('feed-mobile')) {
						await page.goto(`${BASE_URL}/`);
						await waitForImages(page);
						await save('feed-mobile.png', await page.screenshot());
					}
					if (wants('detail-mobile')) await shootDetail(page, 'detail-mobile.png');
					if (wants('discover-mobile')) {
						await page.goto(`${BASE_URL}/discover`);
						await waitForImages(page);
						await save('discover-mobile.png', await page.screenshot());
					}
					if (wants('quotes-mobile'))
						await shootPage(page, '/quotes', 'quotes-mobile.png', 'It works on my machine.');
					if (wants('upload-mobile')) await shootUpload(page);
					if (wants('report-dialog-mobile')) await shootReportDialog(page);
				},
				{ mobile: true }
			);
		if (wantsAny('moderation-queue-mobile', 'moderation-timeouts-mobile'))
			await withContext(
				browser,
				MOBILE,
				async (page) => {
					if (wants('moderation-queue-mobile'))
						await shootQueue(page, 'moderation-queue-mobile.png');
					if (wants('moderation-timeouts-mobile'))
						await shootPage(
							page,
							'/moderation/timeouts',
							'moderation-timeouts-mobile.png',
							'Timeouts'
						);
				},
				{ mobile: true, account: ADMIN }
			);
		if (wants('maintenance-mobile')) await shootMaintenance(browser);
		if (wantsAny('detail-badges-mobile', 'moderation-users-mobile'))
			await withContext(
				browser,
				MOBILE,
				async (page) => {
					if (wants('detail-badges-mobile'))
						await shootDetailBadges(page, 'detail-badges-mobile.png');
					if (wants('moderation-users-mobile'))
						await shootUsers(page, 'moderation-users-mobile.png');
				},
				{ mobile: true, account: ADMIN }
			);
		if (
			wantsAny(
				'profile-mobile',
				'profile-edit-mobile',
				'stats-mobile',
				'notifications-mobile',
				'profile-notifications-mobile',
				'search-mobile',
				'member-mobile',
				'awards-mobile'
			)
		)
			await withContext(
				browser,
				MOBILE,
				async (page) => {
					if (wants('profile-mobile'))
						await shootPage(page, '/profile', 'profile-mobile.png', OWNER.username);
					if (wants('profile-edit-mobile'))
						await shootPage(page, '/profile/edit', 'profile-edit-mobile.png', 'Save');
					if (wants('stats-mobile'))
						await shootPage(page, '/profile/stats', 'stats-mobile.png', 'Stats');
					if (wants('notifications-mobile'))
						await shootPage(page, '/notifications', 'notifications-mobile.png', 'Notifications');
					if (wants('profile-notifications-mobile'))
						await shootPage(
							page,
							'/profile/notifications',
							'profile-notifications-mobile.png',
							'Save'
						);
					if (wants('search-mobile'))
						// hits a meme, a tag and a quote in the demo data
						await shootPage(page, '/search?q=metting', 'search-mobile.png', 'Memes');
					if (wants('member-mobile')) {
						await page.goto(`${BASE_URL}/search?q=%40jonas`);
						const href = await page.locator('a[href^="/users/"]').first().getAttribute('href');
						if (!href) throw new Error('no member link for jonas');
						await shootPage(page, href, 'member-mobile.png', 'Member since');
					}
					if (wants('awards-mobile'))
						// last month's winner from the seed, plus whoever leads the running month
						await shootPage(page, '/awards', 'awards-mobile.png', 'Meme of the Month');
				},
				{ mobile: true, account: OWNER }
			);
		if (wants('feed-light-mobile'))
			await withContext(
				browser,
				MOBILE,
				async (page) => {
					await page.goto(`${BASE_URL}/`);
					await waitForImages(page);
					await save('feed-light-mobile.png', await page.screenshot());
				},
				{ mobile: true, colorScheme: 'light' }
			);
		if (wants('feed-halloween-mobile'))
			await withContext(
				browser,
				MOBILE,
				async (page) => {
					// the admin preview is request-scoped: nothing is persisted, nothing to reset
					await page.goto(`${BASE_URL}/?season=halloween`);
					await waitForImages(page);
					await save('feed-halloween-mobile.png', await page.screenshot());
				},
				{ mobile: true, account: ADMIN }
			);
		if (wantsAny('feed-desktop', 'detail-desktop'))
			await withContext(
				browser,
				DESKTOP,
				async (page) => {
					if (wants('feed-desktop')) {
						await page.goto(`${BASE_URL}/`);
						await waitForImages(page);
						await save('feed-desktop.png', await page.screenshot());
					}
					if (wants('detail-desktop')) await shootDetail(page, 'detail-desktop.png');
				},
				{ mobile: false }
			);
		if (wants('moderation-queue-desktop'))
			await withContext(
				browser,
				DESKTOP,
				(page) => shootQueue(page, 'moderation-queue-desktop.png'),
				{ mobile: false, account: ADMIN }
			);
	} finally {
		try {
			if (previous) await setSeasons(browser, previous);
		} finally {
			await browser.close();
		}
	}
}

await main();
