/**
 * Seeds the dev database and bucket with a handful of believable demo memes, so the
 * README screenshots (see scripts/readme-screenshots.ts) show a lived-in board.
 *
 *   npx tsx --env-file=.env scripts/seed-demo.ts
 *
 * Goes through the real server modules (createMedia, applyVote, addComment), so
 * thumbnails and S3 objects are real. Refuses to touch anything that is not a private
 * address unless LOKI_SEED_FORCE=1 is set. Idempotent: exits early if the board already
 * holds six or more memes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { count, eq } from 'drizzle-orm';

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

const [{ default: sharp }, { db, client }, schema, { createMedia }, votesMod, commentsMod, jobs] =
	await Promise.all([
		import('sharp'),
		import('../src/lib/server/db'),
		import('../src/lib/server/db/schema'),
		import('../src/lib/server/media/create'),
		import('../src/lib/server/votes'),
		import('../src/lib/server/comments'),
		import('../src/lib/server/jobs')
	]);
const { users, media, comments } = schema;
const { applyVote } = votesMod;
const { addComment } = commentsMod;

type DemoUser = { sub: string; username: string };

// The first three upload and comment; the rest only vote, so scores can reach believable sizes.
const AUTHORS: DemoUser[] = [
	{ sub: 'demo-lena', username: 'lena' },
	{ sub: 'demo-jonas', username: 'jonas' },
	{ sub: 'demo-noah', username: 'noah' }
];
const VOTERS: DemoUser[] = [
	{ sub: 'demo-mira', username: 'mira' },
	{ sub: 'demo-tobi', username: 'tobi' },
	{ sub: 'demo-anke', username: 'anke' },
	{ sub: 'demo-kemal', username: 'kemal' },
	{ sub: 'demo-yusuf', username: 'yusuf' }
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
		title: 'Montag, 7:00 Uhr',
		caption: ['MONTAG,', '7:00 UHR'],
		width: 1080,
		height: 1080,
		hues: [222, 262],
		author: 'lena',
		tags: ['montag', 'office', 'kaffee'],
		up: ['jonas', 'noah', 'mira', 'tobi', 'anke', 'kemal', 'yusuf'],
		down: [],
		hoursAgo: 6,
		views: 33,
		comments: [
			{ by: 'jonas', text: 'Das bin ich, jeden einzelnen Montag.' },
			{ by: 'mira', text: 'Der Kaffee hat noch nicht mal angefangen zu wirken.' },
			{ by: 'noah', text: 'Und dann direkt das Daily um 9.' }
		]
	},
	{
		title: 'Code Review sagt: LGTM',
		caption: ['CODE REVIEW', 'SAGT: LGTM', '(2000 ZEILEN)'],
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
			{ by: 'lena', text: 'Gelesen hat das niemand, oder?' },
			{ by: 'tobi', text: 'Approved nach 40 Sekunden. Respekt.' },
			{ by: 'noah', text: 'LGTM heißt bei uns: Looks Great, Tests Missing.' }
		]
	},
	{
		title: 'Deploy am Freitag',
		caption: ['DEPLOY', 'AM FREITAG', 'UM 16:55'],
		width: 900,
		height: 1200,
		hues: [8, 38],
		author: 'noah',
		tags: ['devops', 'freitag', 'prod'],
		up: ['lena', 'jonas', 'mira', 'kemal', 'yusuf', 'anke', 'tobi', 'noah'],
		down: [],
		hoursAgo: 20,
		views: 58,
		comments: [
			{ by: 'anke', text: 'Wer das macht, bringt am Montag Kuchen mit.' },
			{ by: 'jonas', text: 'Wir haben nur noch ein kleines Hotfix.' }
		]
	},
	{
		title: 'Meeting, das eine Mail sein könnte',
		caption: ['MEETING,', 'DAS EINE MAIL', 'SEIN KÖNNTE'],
		width: 1080,
		height: 1350,
		hues: [284, 326],
		author: 'lena',
		tags: ['meeting', 'office'],
		up: ['jonas', 'mira', 'tobi', 'anke'],
		down: ['kemal'],
		hoursAgo: 31,
		views: 27,
		comments: [{ by: 'mira', text: 'Zwei Stunden. Ohne Agenda.' }]
	},
	{
		title: 'Kaffee Nr. 4',
		caption: ['KAFFEE', 'NR. 4'],
		width: 1200,
		height: 900,
		hues: [24, 48],
		author: 'jonas',
		tags: ['kaffee', 'office'],
		up: ['lena', 'noah'],
		down: ['yusuf'],
		hoursAgo: 52,
		views: 19,
		comments: []
	},
	{
		title: 'Prod ist down (nicht von mir)',
		caption: ['PROD IST DOWN', '(NICHT VON MIR)'],
		width: 1080,
		height: 1080,
		hues: [350, 14],
		author: 'noah',
		tags: ['prod', 'devops', 'incident'],
		up: [],
		down: ['lena', 'anke'],
		hoursAgo: 78,
		views: 22,
		comments: [{ by: 'lena', text: 'Das Git-Blame sieht das anders.' }]
	}
];

const escapeXml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders a meme-card style JPEG: soft gradient, decorative blobs, bold white caption with dark outline. */
async function renderMeme(m: DemoMeme): Promise<Buffer> {
	const { width: w, height: h, hues, caption } = m;
	const longest = Math.max(...caption.map((l) => l.length));
	// Fit the longest line into ~88% of the width (bold sans caps are about 0.55em wide in Impact).
	const fontSize = Math.min(w * 0.2, (w * 0.88) / (longest * 0.55));
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
	await db
		.insert(users)
		.values({ ...u, role: 'member' })
		.onConflictDoNothing();
	const [row] = await db
		.select({ id: users.id, username: users.username, role: users.role })
		.from(users)
		.where(eq(users.sub, u.sub));
	return row;
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

	const [{ n }] = await db.select({ n: count() }).from(media);
	if (n >= MIN_MEMES) {
		console.log(`Board already has ${n} memes (>= ${MIN_MEMES}); nothing to seed.`);
		return;
	}

	const byName = new Map<string, Awaited<ReturnType<typeof ensureUser>>>();
	for (const u of [...AUTHORS, ...VOTERS]) byName.set(u.username, await ensureUser(u));
	console.log(`Users ready: ${[...byName.keys()].join(', ')}`);

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
	console.log('Done.');
}

try {
	await main();
} finally {
	await client.end();
}
