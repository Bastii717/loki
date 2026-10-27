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
- The dev database may be empty or already seeded. Seeding is idempotent: every block (memes, quotes, report, rules and FAQ, favorite) skips itself when its rows exist. To reseed from scratch, a human must clear the database first (the test suite truncates it but leaves a few untitled media rows; do not run `npm test` between seeding and shooting).
- Hosts without fonts or Chromium system libraries (no fontconfig: meme captions render as boxes; no libatk: Chromium will not start): run BOTH the seed and the screenshot script inside the Playwright container, with the dev server still on the host. Seeding on the host would bake the broken captions into the stored images.

  ```sh
  docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v ~/Git/loki:/rig -w /rig mcr.microsoft.com/playwright:v1.64.0-noble \
    bash -c "npx tsx --env-file=.env scripts/seed-demo.ts"
  ```

  Use the same command with `scripts/readme-screenshots.ts` (optionally with `--only=...`) for step 3.

## Steps

1. Seed the demo data (refuses to run unless `DATABASE_URL` points at a private address or `LOKI_SEED_FORCE=1` is set; never force it against production):

   ```sh
   npx tsx --env-file=.env scripts/seed-demo.ts
   ```

   This creates demo users, six generated meme images (real thumbnails and S3 objects via `createMedia`), English tags, votes (some negative) and comments, plus three quotes with votes, one open report (category misinformation, on "Prod is down (not my fault)"), rules and FAQ Markdown, one favorite and an avatar for `lena` (a letter image rendered with sharp, set once through `setAvatar`). `--preview=DIR` only renders the images to DIR without touching anything.

2. Start the dev server in the background (port 5173, must match `ORIGIN` in `.env`) and wait until `http://localhost:5173/login` answers:

   ```sh
   node --env-file=.env node_modules/vite/bin/vite.js dev
   ```

3. Take the screenshots:

   ```sh
   npx tsx --env-file=.env scripts/readme-screenshots.ts
   ```

   It signs in through the mock OIDC provider (a throwaway member, an admin for the moderation shots, the seeded `lena` for the profile pages) and writes 19 shots. Mobile is 390x844 @2x and dark unless the name says light, desktop is 1440x900 @2x:

   | Mobile                       | Desktop                    |
   | ---------------------------- | -------------------------- |
   | `feed-mobile`                | `feed-desktop`             |
   | `detail-mobile`              | `detail-desktop`           |
   | `discover-mobile`            | `moderation-queue-desktop` |
   | `quotes-mobile`              |                            |
   | `profile-mobile`             |                            |
   | `profile-edit-mobile`        |                            |
   | `detail-badges-mobile`       |                            |
   | `moderation-users-mobile`    |                            |
   | `stats-mobile`               |                            |
   | `upload-mobile`              |                            |
   | `report-dialog-mobile`       |                            |
   | `moderation-queue-mobile`    |                            |
   | `moderation-timeouts-mobile` |                            |
   | `maintenance-mobile`         |                            |
   | `feed-light-mobile`          |                            |
   | `feed-halloween-mobile`      |                            |

   `detail-*` is the meme with the most comments; `discover-mobile` shows whichever slide the shuffle serves first. `feed-halloween-mobile` is the feed as an admin with the request-scoped preview `/?season=halloween`, so nothing is switched on afterwards. `maintenance-mobile` switches maintenance on as an admin (message `Deploy in progress, back around 18:30`), shoots the feed as a different plain member so the banner shows without the admin addendum, and always switches it off again; if a run dies hard, turn it off on `/moderation/maintenance`. `profile-mobile` is the seeded `lena`, who has an avatar and a motto from the seed; `profile-edit-mobile` is her editor. `detail-badges-mobile` is the same meme as `detail-*`, shot as the screenshot admin after that admin has commented once (`Approved by the mods.`, skipped when it exists), so the badge comes from the screenshot run itself: the seed promotes nobody. `moderation-users-mobile` is the admin user list, scrolled to `lena`. The run reads the current season mode from `/moderation/theme`, switches the seasonal themes off as an admin before the first shot and restores that mode afterwards, so a forced theme stays forced (event themes follow the calendar, so shots would otherwise change colour around Halloween, Advent and Carnival); if a run dies hard, reset them on `/moderation/theme`. Pass `--only=feed-desktop,quotes-mobile` (comma-separated names, without `.png`) to retake just some shots. Set `SCREENSHOT_DEBUG=1` to log failed requests and redirects.

4. Stop the dev server again.

5. Open each PNG with Read and check it: sharp images loaded (no gray placeholders), captions fully inside the images, English UI, right theme, tab bar at the bottom on mobile, votes and comments visible, no error banners or unintended empty states. Retake if anything is off; fix the cause in the scripts rather than editing PNGs by hand.

## Where things land and how the README uses them

- Output: `docs/screenshots/<name>.png` for each name above (19 files).
- `README.md` has a `## Screenshots` section: one caption line per row, then a `<p align="center">` with up to three `<img ... width="30%">` of mobile shots (Feed and Discover; Detail, Quotes and Profile; Profiles; Stats, Upload and Report; Moderation with the maintenance banner; Themes with the light and Halloween feeds), then the three desktop shots each full width in their own `<p>`. Relative paths, English alt texts. Keep file names stable so the README needs no change on a refresh.

## House rules

- English UI copy, captions and alt texts, code and docs; no emojis anywhere.
- Dark theme except `feed-light-mobile` (the script sets `colorScheme` per context; the app follows `prefers-color-scheme`).
- Keep each PNG under about 600 KB and all together under 6 MB; the script re-encodes with sharp and warns if it cannot. Do not reduce the 2x scale to save space unless the budget is truly out of reach.
- Chromium may be blocked from LAN hosts on macOS (local network privacy). The script therefore routes LAN requests (OIDC, S3 behind the media redirect) through Node and blocks third-party hosts. Do not remove that.
- Before committing: `npx prettier --check .`, `npm run lint`, `npm run check`. Commit with a conventional message (for example `docs: refresh README screenshots`), stage files explicitly, end the message with a blank line and the `Co-Authored-By:` trailer from your instructions, and do not push unless asked. Do not touch `.github/workflows`.
