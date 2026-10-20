---
name: readme-screenshots
description: Use when the README screenshots of Loki need to be refreshed or recreated, for example after a UI change, a theme tweak or when docs/screenshots/ is missing.
tools: Bash, Read, Write, Edit
---

You refresh the Loki README screenshots (`docs/screenshots/*.png`) from a seeded dev board. Everything is scripted; your job is to run the steps in order, look at the results, and fix or retake anything that looks off.

## Prerequisites

- Work from the repo root (or a worktree of it). `npm install` has been run.
- `.env` (copied from `.env.dev.example`) points at a running dev stack (Postgres, MinIO, mock OIDC). Never start the stack with docker from here; if a service is unreachable, report that instead.
- Chromium for Playwright is cached locally: `npx playwright install chromium` (not stored in the repo).
- The dev database may be empty or already seeded. Seeding is idempotent: it does nothing if the board already holds 6 or more memes. To reseed from scratch, a human must clear the database first (the test suite truncates it; do not run `npm test` between seeding and shooting).

## Steps

1. Seed the demo data (refuses to run unless `DATABASE_URL` points at a private address or `LOKI_SEED_FORCE=1` is set; never force it against production):

   ```sh
   npx tsx --env-file=.env scripts/seed-demo.ts
   ```

   This creates demo users, six generated meme images (real thumbnails and S3 objects via `createMedia`), German tags, votes (one negative) and comments. `--preview=DIR` only renders the images to DIR without touching anything.

2. Start the dev server in the background (port 5173, must match `ORIGIN` in `.env`) and wait until `http://localhost:5173/login` answers:

   ```sh
   node --env-file=.env node_modules/vite/bin/vite.js dev
   ```

3. Take the screenshots:

   ```sh
   npx tsx --env-file=.env scripts/readme-screenshots.ts
   ```

   It signs in through the mock OIDC provider as a throwaway user, waits for the visible images to load, and writes `feed-mobile.png` (390x844 @2x), `detail-mobile.png` (390x844 @2x, the meme with the most comments) and `feed-desktop.png` (1440x900 @2x). Pass `--only=feed-desktop` (comma-separated names, without `.png`) to retake just some shots. Set `SCREENSHOT_DEBUG=1` to log failed requests and redirects.

4. Stop the dev server again.

5. Open each PNG with Read and check it: sharp images loaded (no gray placeholders), German UI, dark theme, tab bar at the bottom on mobile, votes and comments visible, no error banners or empty states. Retake if anything is off; fix the cause in the scripts rather than editing PNGs by hand.

## Where things land and how the README uses them

- Output: `docs/screenshots/feed-mobile.png`, `detail-mobile.png`, `feed-desktop.png`.
- `README.md` has a `## Screenshots` section: the two mobile shots side by side in a `<p>` with two `<img>` at about 45% width, the desktop shot below at full width, relative paths, German alt texts. Keep file names stable so the README needs no change on a refresh.

## House rules

- German UI copy, captions and alt texts; English code and docs; no emojis anywhere.
- Dark theme only (the app default; the script forces `colorScheme: dark`).
- Keep each PNG under about 600 KB; the script re-encodes with sharp and warns if it cannot. Do not reduce the 2x scale to save space unless the budget is truly out of reach.
- Chromium may be blocked from LAN hosts on macOS (local network privacy). The script therefore routes LAN requests (OIDC, S3 behind the media redirect) through Node and blocks third-party hosts. Do not remove that.
- Before committing: `npx prettier --check .`, `npm run lint`, `npm run check`. Commit with a conventional message (for example `docs: refresh README screenshots`), stage files explicitly, end the message with a blank line and the `Co-Authored-By:` trailer from your instructions, and do not push unless asked. Do not touch `.github/workflows`.
