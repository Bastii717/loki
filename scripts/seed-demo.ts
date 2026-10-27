/**
 * Seeds the dev database and bucket with a handful of believable demo memes, so the
 * README screenshots (see scripts/readme-screenshots.ts) show a lived-in board.
 *
 *   npx tsx --env-file=.env scripts/seed-demo.ts
 *
 * Goes through the real server modules (createMedia, applyVote, addComment), so
 * thumbnails and S3 objects are real. Refuses to touch anything that is not a private
 * address unless LOKI_SEED_FORCE=1 is set. Idempotent: every block (memes, quotes, report,
 * rules and FAQ, favorite) is skipped when its rows already exist.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, count, eq, isNull } from 'drizzle-orm';

const MIN_MEMES = 6;

/** True for loopback and RFC 1918 hosts; the seed must never run against production. */
function isPrivateHost(host: string): boolean {
	if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
		return true;
	}
	const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function guardDatabase(): void {
	const raw = process.env.DATABASE_URL;
	if (!raw) {
		console.error('DATABASE_URL is not set (run with --env-file=.env).');
		process.exit(1);
	}
	let host: string;
	try {
		host = new URL(raw).hostname;
	} catch {
		console.error('DATABASE_URL is not a valid URL.');
		process.exit(1);
	}
	if (isPrivateHost(host) || process.env.LOKI_SEED_FORCE === '1') return;
	console.error(
		`Refusing to seed: database host "${host}" is not a private address. ` +
			'Set LOKI_SEED_FORCE=1 only if you are sure this is not production.'
	);
	process.exit(1);
}

// Must run before the server modules are imported: importing ../src/lib/server/db opens a connection.
guardDatabase();

const [
	{ default: sharp },
	{ db, client },
	schema,
	{ createMedia },
	votesMod,
	commentsMod,
	jobs,
	quotesMod,
	moderationMod,
	memesMod,
	{ nameKey },
	{ setAvatar }
] = await Promise.all([
	import('sharp'),
	import('../src/lib/server/db'),
	import('../src/lib/server/db/schema'),
	import('../src/lib/server/media/create'),
	import('../src/lib/server/votes'),
	import('../src/lib/server/comments'),
	import('../src/lib/server/jobs'),
	import('../src/lib/server/quotes'),
	import('../src/lib/server/moderation'),
	import('../src/lib/server/memes'),
	import('../src/lib/server/profile'),
	import('../src/lib/server/avatar')
]);
const { users, media, comments, quotes, reports, siteContent, favorites } = schema;
const { applyVote } = votesMod;
const { addComment } = commentsMod;
const { addQuote, voteQuote } = quotesMod;
const { createReport } = moderationMod;
const { toggleFavorite } = memesMod;

type DemoUser = {
	sub: string;
	username: string;
	displayName: string;
	motto?: string;
};

// The first three upload and comment; the rest only vote, so scores can reach believable sizes.
const AUTHORS: DemoUser[] = [
	{ sub: 'demo-lena', username: 'lena', displayName: 'Lena', motto: 'Coffee first, memes second.' },
	{ sub: 'demo-jonas', username: 'jonas', displayName: 'Jonas' },
	{ sub: 'demo-noah', username: 'noah', displayName: 'Noah', motto: 'It works on my machine.' }
];
const VOTERS: DemoUser[] = [
	{ sub: 'demo-mira', username: 'mira', displayName: 'Mira' },
	{ sub: 'demo-tobi', username: 'tobi', displayName: 'Tobi' },
	{ sub: 'demo-anke', username: 'anke', displayName: 'Anke' },
	{ sub: 'demo-kemal', username: 'kemal', displayName: 'Kemal' },
	{ sub: 'demo-yusuf', username: 'yusuf', displayName: 'Yusuf' }
];

interface DemoMeme {
	title: string;
	caption: string[];
	width: number;
	height: number;
	/** Hue pair (degrees) for the gradient background. */
	hues: [number, number];
	author: string;
	tags: string[];
	/** Up-voters (by username), down-voters; everyone else abstains. */
	up: string[];
	down: string[];
	/** Hours ago the meme was "posted". */
	hoursAgo: number;
	views: number;
	comments: { by: string; text: string }[];
}

const MEMES: DemoMeme[] = [
	{
		title: 'Monday, 7:00 AM',
		caption: ['MONDAY,', '7:00 AM'],
		width: 1080,
		height: 1080,
		hues: [222, 262],
		author: 'lena',
		tags: ['monday', 'office', 'coffee'],
		up: ['jonas', 'noah', 'mira', 'tobi', 'anke', 'kemal', 'yusuf'],
		down: [],
		hoursAgo: 6,
		views: 33,
		comments: [
			{ by: 'jonas', text: 'This is me, every single Monday.' },
			{ by: 'mira', text: 'The coffee has not even kicked in yet.' },
			{ by: 'noah', text: 'And then straight into the 9 AM standup.' }
		]
	},
	{
		title: 'Code review says: LGTM',
		caption: ['CODE REVIEW', 'SAYS: LGTM', '(2000 LINES)'],
		width: 1200,
		height: 900,
		hues: [152, 190],
		author: 'jonas',
		tags: ['devops', 'codereview', 'office'],
		up: ['lena', 'noah', 'mira', 'tobi', 'anke'],
		down: [],
		hoursAgo: 2,
		views: 41,
		comments: [
			{ by: 'lena', text: 'Nobody actually read this, did they?' },
			{ by: 'tobi', text: 'Approved after 40 seconds. Respect.' },
			{ by: 'noah', text: 'LGTM means Looks Great, Tests Missing around here.' }
		]
	},
	{
		title: 'Deploy on Friday',
		caption: ['DEPLOY ON', 'FRIDAY AT', '4:55 PM'],
		width: 900,
		height: 1200,
		hues: [8, 38],
		author: 'noah',
		tags: ['devops', 'friday', 'prod'],
		up: ['lena', 'jonas', 'mira', 'kemal', 'yusuf', 'anke', 'tobi', 'noah'],
		down: [],
		hoursAgo: 20,
		views: 58,
		comments: [
			{ by: 'anke', text: 'Whoever does this brings cake on Monday.' },
			{ by: 'jonas', text: 'It is just one tiny hotfix.' }
		]
	},
	{
		title: 'A meeting that could have been an email',
		caption: ['A MEETING THAT', 'COULD HAVE BEEN', 'AN EMAIL'],
		width: 1080,
		height: 1350,
		hues: [284, 326],
		author: 'lena',
		tags: ['meeting', 'office'],
		up: ['jonas', 'mira', 'tobi', 'anke'],
		down: ['kemal'],
		hoursAgo: 31,
		views: 27,
		comments: [{ by: 'mira', text: 'Two hours. No agenda.' }]
	},
	{
		title: 'Coffee no. 4',
		caption: ['COFFEE', 'NO. 4'],
		width: 1200,
		height: 900,
		hues: [24, 48],
		author: 'jonas',
		tags: ['coffee', 'office'],
		up: ['lena', 'noah'],
		down: ['yusuf'],
		hoursAgo: 52,
		views: 19,
		comments: []
	},
	{
		title: 'Prod is down (not my fault)',
		caption: ['PROD IS DOWN', '(NOT MY FAULT)'],
		width: 1080,
		height: 1080,
		hues: [350, 14],
		author: 'noah',
		tags: ['prod', 'devops', 'incident'],
		up: [],
		down: ['lena', 'anke'],
		hoursAgo: 78,
		views: 22,
		comments: [{ by: 'lena', text: 'Blame says otherwise.' }]
	}
];

interface DemoQuote {
	text: string;
	author: string;
	by: string;
	up: string[];
	down: string[];
}

const QUOTES: DemoQuote[] = [
	{
		text: 'It works on my machine.',
		author: 'Every developer, shortly before the incident',
		by: 'jonas',
		up: ['lena', 'noah', 'mira', 'tobi', 'anke'],
		down: []
	},
	{
		text: "Let's take this offline.",
		author: 'A manager, mid-meeting, eyeing the clock',
		by: 'lena',
		up: ['jonas', 'mira', 'kemal'],
		down: ['yusuf']
	},
	{
		text: 'This is just a quick fix.',
		author: 'Famous last words, Friday 4:55 PM',
		by: 'noah',
		up: ['lena', 'jonas', 'tobi', 'anke', 'kemal', 'yusuf'],
		down: []
	}
];

const RULES_MARKDOWN = `# House rules

Be kind, be funny, in that order.

## The basics

- Post memes your colleagues will actually enjoy.
- No hate, no doxxing, no drama.
- Mark spoilers and NSFW memes, or the moderators will mark you.
- Credit the original author when you know them.

**Short version: do not be the reason for a rule change.**
`;

const FAQ_MARKDOWN = `# Frequently asked questions

## How do I post a meme?

Tap the plus button, pick an image or a short video, add a title and a few tags, done.

## Why was my meme removed?

Usually because it broke a house rule. Ask a moderator, they are friendlier than they look.

## Who can see what I post?

Everyone who is signed in, and nobody else. This is a closed board.

**Still stuck? Ask in the office chat, someone will know.**
`;

const escapeXml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders a meme-card style JPEG: soft gradient, decorative blobs, bold white caption with dark outline. */
async function renderMeme(m: DemoMeme): Promise<Buffer> {
	const { width: w, height: h, hues, caption } = m;
	const longest = Math.max(...caption.map((l) => l.length));
	// Fit the longest line into ~88% of the width. Bold sans caps are about 0.55em wide in Impact,
	// but the fallback faces (Arial Black, DejaVu Sans Bold) run wider, so plan for 0.64em.
	const fontSize = Math.min(w * 0.2, (w * 0.88) / (longest * 0.64));
	const lineHeight = fontSize * 1.14;
	const startY = h / 2 - ((caption.length - 1) * lineHeight) / 2 + fontSize * 0.34;
	const stroke = Math.max(6, fontSize * 0.09);
	const lines = caption
		.map(
			(line, i) =>
				`<text x="${w / 2}" y="${(startY + i * lineHeight).toFixed(1)}" text-anchor="middle">${escapeXml(line)}</text>`
		)
		.join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hues[0]},68%,46%)"/>
      <stop offset="1" stop-color="hsl(${hues[1]},72%,32%)"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.38"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${w * 0.88}" cy="${h * 0.14}" r="${Math.min(w, h) * 0.3}" fill="#fff" fill-opacity="0.08"/>
  <circle cx="${w * 0.1}" cy="${h * 0.92}" r="${Math.min(w, h) * 0.38}" fill="#fff" fill-opacity="0.06"/>
  <circle cx="${w * 0.2}" cy="${h * 0.12}" r="${Math.min(w, h) * 0.1}" fill="#000" fill-opacity="0.08"/>
  <rect width="${w}" height="${h}" fill="url(#vignette)"/>
  <g font-family="Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif" font-weight="900"
     font-size="${fontSize.toFixed(1)}" fill="#fff" stroke="rgba(10,10,20,0.78)"
     stroke-width="${stroke.toFixed(1)}" stroke-linejoin="round" paint-order="stroke fill"
     letter-spacing="${(fontSize * 0.01).toFixed(1)}">${lines}</g>
</svg>`;
	return sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

async function ensureUser(u: DemoUser) {
	const { displayName, motto, ...account } = u;
	await db
		.insert(users)
		.values({
			...account,
			role: 'member',
			displayName,
			displayNameKey: nameKey(displayName),
			motto: motto ?? ''
		})
		.onConflictDoNothing();
	// users seeded before display names existed get theirs on the next run (never overwrites a chosen one)
	await db
		.update(users)
		.set({ displayName, displayNameKey: nameKey(displayName) })
		.where(and(eq(users.sub, u.sub), isNull(users.displayName)));
	if (motto) {
		// only fills an empty motto, never overwrites one the user wrote
		await db
			.update(users)
			.set({ motto })
			.where(and(eq(users.sub, u.sub), eq(users.motto, '')));
	}
	const [row] = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			role: users.role,
			avatarKey: users.avatarKey
		})
		.from(users)
		.where(eq(users.sub, u.sub));
	return row;
}

/** A 512x512 letter avatar: a coloured circle with the first letter of the name on top. */
function renderAvatar(letter: string, hue: number): Promise<Buffer> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="hsl(${hue},40%,18%)"/>
  <circle cx="256" cy="256" r="216" fill="hsl(${hue},68%,48%)"/>
  <text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"
        font-weight="900" font-size="280" fill="#fff">${escapeXml(letter)}</text>
</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Gives lena an avatar once; a user who already has one is left alone. */
async function ensureAvatar(user: Awaited<ReturnType<typeof ensureUser>>) {
	if (user.avatarKey) return;
	const { id, username, displayName, role } = user;
	await setAvatar({ id, username, displayName, role }, await renderAvatar('L', 28));
	console.log(`Avatar set for ${username}.`);
}

/** `--preview=DIR` renders the meme images to DIR and exits without touching the database. */
async function preview(dir: string) {
	await mkdir(dir, { recursive: true });
	for (const [i, m] of MEMES.entries()) {
		await writeFile(join(dir, `meme-${i + 1}.jpg`), await renderMeme(m));
	}
	console.log(`Rendered ${MEMES.length} previews to ${dir}`);
}

async function main() {
	const previewDir = process.argv
		.find((a) => a.startsWith('--preview='))
		?.slice('--preview='.length);
	if (previewDir) return preview(previewDir);

	const byName = new Map<string, Awaited<ReturnType<typeof ensureUser>>>();
	for (const u of [...AUTHORS, ...VOTERS]) byName.set(u.username, await ensureUser(u));
	console.log(`Users ready: ${[...byName.keys()].join(', ')}`);
	await ensureAvatar(byName.get('lena')!);

	await seedMemes(byName);
	await seedExtras(byName);
	console.log('Done.');
}

type UserMap = Map<string, Awaited<ReturnType<typeof ensureUser>>>;

async function seedMemes(byName: UserMap) {
	const [{ n }] = await db.select({ n: count() }).from(media);
	if (n >= MIN_MEMES) {
		console.log(`Board already has ${n} memes (>= ${MIN_MEMES}); not seeding memes.`);
		return;
	}

	// Oldest first, so comment and vote ids follow the story.
	for (const m of [...MEMES].sort((a, b) => b.hoursAgo - a.hoursAgo)) {
		const author = byName.get(m.author)!;
		const { id } = await createMedia({
			uploader: author,
			file: await renderMeme(m),
			title: m.title,
			tagNames: m.tags,
			nsfw: false,
			spoiler: false
		});
		for (const name of m.up) await applyVote(byName.get(name)!.id, id, 1);
		for (const name of m.down) await applyVote(byName.get(name)!.id, id, -1);
		const postedAt = Date.now() - m.hoursAgo * 3_600_000;
		await db
			.update(media)
			.set({ createdAt: new Date(postedAt), viewCount: m.views })
			.where(eq(media.id, id));
		// comments arrive a while after the post, ~17 minutes apart
		for (const [i, c] of m.comments.entries()) {
			const comment = await addComment(byName.get(c.by)!.id, id, c.text);
			await db
				.update(comments)
				.set({ createdAt: new Date(postedAt + (i + 1) * 17 * 60_000) })
				.where(eq(comments.id, comment.id));
		}
		console.log(`Seeded #${id} "${m.title}"`);
	}

	await jobs.recomputeHotScores();
}

/** Quotes, one open report, rules and FAQ, one favorite. Each block skips itself when rows exist. */
async function seedExtras(byName: UserMap) {
	const [{ n: quoteCount }] = await db.select({ n: count() }).from(quotes);
	if (quoteCount === 0) {
		for (const q of QUOTES) {
			const { id } = await addQuote(byName.get(q.by)!.id, q.text, q.author);
			for (const name of q.up) await voteQuote(byName.get(name)!.id, id, 1);
			for (const name of q.down) await voteQuote(byName.get(name)!.id, id, -1);
		}
		console.log(`Seeded ${QUOTES.length} quotes`);
	}

	const [{ n: reportCount }] = await db.select({ n: count() }).from(reports);
	if (reportCount === 0) {
		const [target] = await db
			.select({ id: media.id })
			.from(media)
			.where(eq(media.title, 'Prod is down (not my fault)'));
		const mira = byName.get('mira')!;
		if (target) {
			await createReport(
				{ id: mira.id, username: mira.username, displayName: null, role: 'member' },
				'meme',
				target.id,
				'misinformation',
				'Prod was down because of a DNS change, not a deploy.'
			);
			console.log(`Seeded a report on #${target.id}`);
		}
	}

	const [{ n: contentCount }] = await db.select({ n: count() }).from(siteContent);
	if (contentCount === 0) {
		await db.insert(siteContent).values([
			{ key: 'rules', markdown: RULES_MARKDOWN },
			{ key: 'faq', markdown: FAQ_MARKDOWN }
		]);
		console.log('Seeded rules and FAQ');
	}

	const [{ n: favoriteCount }] = await db.select({ n: count() }).from(favorites);
	if (favoriteCount === 0) {
		const [first] = await db.select({ id: media.id }).from(media).orderBy(media.id).limit(1);
		if (first) {
			await toggleFavorite(byName.get('lena')!.id, first.id);
			console.log(`Seeded a favorite on #${first.id}`);
		}
	}
}

try {
	await main();
} finally {
	await client.end();
}
