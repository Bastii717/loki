# Loki

Loki is a meme board for one team and nobody else. It is built for 25–50 people who want to post, vote on and argue about work-and-industry memes from their phones, without any of it ever being publicly reachable. It is a ground-up rewrite of MemeLord, a Django fork the team outgrew, and is named after the god of mischief.

## Features

Planned and being built. The whole app is English: UI, code and docs.

- **Card feed** with in-feed voting, comment counts and hashtag chips. Views for New, Hot and Hall of Fame.
- **Discover**: fullscreen swipe through memes you have not seen yet, then random old gems.
- **Comments**, **favorites** and swipe-between-memes in the detail view.
- **Trending** via a periodically recomputed hot score, plus the **Hall of Fame**.
- **Quotes** page with its own voting and submission form.
- **Tags** with autocomplete and hashtag filtering.
- **NSFW and spoiler blur**, set at upload or by moderators.
- **Statistics**: uploads over time, top uploaders and voters, tag distribution.
- **Reports and moderation**: members report memes, comments and quotes. Content with too many open reports is hidden until a moderator decides in the moderation area (queue, timeouts, audit log).
- **Rules and FAQ**, editable by admins in the app.
- **Maintenance mode**: admins pause posting with a message; the app reports its own readiness and shows a designed page during outages.
- **Seasonal themes**: Halloween, Advent and Carnival switch on by date; admins can force an event theme or turn seasons off.
- **Profiles**: pick a display name (once every 30 days), an avatar and a motto; moderators and admins carry a badge.
- **Notifications**: a bell with activity (comments on your memes and threads) and moderation notices, with per-member preferences.
- **Search**: find memes by title, tag or comment; look up people and see what they posted.
- **Meme of the Month**: the top-scored meme of each month gets a trophy automatically; every winner stays on the awards page.
- **Meme generator**: pick a library template or remix any meme, type top and bottom text, post. Rendered in the browser, uploaded like any other meme.
- **PWA** with a share target, so memes can be sent straight from the share sheet.

## Screenshots

Feed and Discover: the board in dark mode, plus one meme at a time.

<p align="center">
  <img src="docs/screenshots/feed-mobile.png" alt="Feed on a phone: meme cards with voting, comments and hashtags, tab bar at the bottom" width="30%">
  <img src="docs/screenshots/discover-mobile.png" alt="Discover on a phone: one full-screen meme with vote, favorite and comment buttons" width="30%">
</p>

Detail, Quotes and Profile: a meme with its comments, the quote wall and your own page.

<p align="center">
  <img src="docs/screenshots/detail-mobile.png" alt="Meme detail view on a phone with hashtags and comments" width="30%">
  <img src="docs/screenshots/quotes-mobile.png" alt="Quotes page on a phone with three voted office quotes" width="30%">
  <img src="docs/screenshots/profile-mobile.png" alt="Profile page on a phone with an avatar, display name, motto, role chip, counters, shortcuts, rules and FAQ" width="30%">
</p>

Profiles: the profile editor, a detail view with role badges on the comments, and the admin user list.

<p align="center">
  <img src="docs/screenshots/profile-edit-mobile.png" alt="Profile editor on a phone with avatar upload, display name and motto fields and a Save button" width="30%">
  <img src="docs/screenshots/detail-badges-mobile.png" alt="Meme detail view on a phone with an admin badge next to a comment author" width="30%">
  <img src="docs/screenshots/moderation-users-mobile.png" alt="Moderation user list on a phone with avatars, display names, role badges and admin tools" width="30%">
</p>

Notifications: the notices page with one unread and several read rows, and the preferences behind the gear link.

<p align="center">
  <img src="docs/screenshots/notifications-mobile.png" alt="Notifications page on a phone with filter chips, a mark-all-as-read button and six notices: one unread comment notice highlighted, the rest read, two moderation notices with an amber edge and a Meme of the Month award" width="30%">
  <img src="docs/screenshots/profile-notifications-mobile.png" alt="Notification preferences on a phone with checkboxes for comments on my memes, thread comments and report outcomes, a note on the always-on notices and a Save button" width="30%">
</p>

Search: memes, tags and quotes for one query, and a member page with their memes.

<p align="center">
  <img src="docs/screenshots/search-mobile.png" alt="Search page on a phone with a query, filter chips and result sections for memes, tags and quotes" width="30%">
  <img src="docs/screenshots/member-mobile.png" alt="Member page on a phone with an avatar, display name, member-since date, meme count and the member's memes" width="30%">
</p>

Meme of the Month: the awards page with the current leader and last month's winner.

<p align="center">
  <img src="docs/screenshots/awards-mobile.png" alt="Awards page on a phone with the meme currently leading the month and last month's winner under a month heading" width="30%">
</p>

Meme generator: the editor with a template and both captions, and the admin template library.

<p align="center">
  <img src="docs/screenshots/create-mobile.png" alt="The editor with a template and both captions" width="30%">
  <img src="docs/screenshots/templates-admin-mobile.png" alt="The admin template library" width="30%">
</p>

Stats, Upload and Report: what the board is up to, how a meme gets onto it, and how one gets flagged.

<p align="center">
  <img src="docs/screenshots/stats-mobile.png" alt="Stats page on a phone: uploads per week, top uploaders, memes and tags" width="30%">
  <img src="docs/screenshots/upload-mobile.png" alt="Upload form on a phone with a picture, a title and two tags" width="30%">
  <img src="docs/screenshots/report-dialog-mobile.png" alt="Report dialog on a phone with a reason selected and a note typed" width="30%">
</p>

Moderation: the open-case queue, the timeout tools and the maintenance banner.

<p align="center">
  <img src="docs/screenshots/moderation-queue-mobile.png" alt="Moderation queue on a phone with one reported meme and its reporter note" width="30%">
  <img src="docs/screenshots/moderation-timeouts-mobile.png" alt="Moderation timeouts page on a phone with the set-timeout form" width="30%">
  <img src="docs/screenshots/maintenance-mobile.png" alt="Feed on a phone with a maintenance banner announcing a deploy in progress" width="30%">
</p>

Themes: the light theme and the Halloween event theme.

<p align="center">
  <img src="docs/screenshots/feed-light-mobile.png" alt="Feed on a phone in the light theme" width="30%">
  <img src="docs/screenshots/feed-halloween-mobile.png" alt="Feed on a phone in the Halloween theme with an orange accent and a ghost icon next to the wordmark" width="30%">
</p>

On a desktop browser the layout stays a centered column.

<p align="center">
  <img src="docs/screenshots/feed-desktop.png" alt="Feed in a desktop browser with the dark theme" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/detail-desktop.png" alt="Meme detail view in a desktop browser with the large image, tags and comment box" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/moderation-queue-desktop.png" alt="Moderation queue in a desktop browser with one open case" width="100%">
</p>

## Security model

- Sign-in is Authentik OIDC only. Access is gated on group membership; a valid Authentik login alone is not enough. Member, moderator and admin roles come from groups.
- Every route requires a session, except login and health checks.
- Every media file sits behind auth too. The storage bucket is never public, and there is no configuration option that makes it so.
- Backups of the database and media are encrypted and go to a separate bucket.

## Tech stack

- SvelteKit 3 (Svelte 5) with TypeScript
- PostgreSQL via Drizzle ORM
- S3-compatible storage: Cloudflare R2 in production, MinIO in development
- Docker (Compose), self-hosted
- GitHub Actions building images to GHCR

## Status

> ⚠️ **Early development.** Scaffold and dev environment are done (Task 1 of 20). Nothing is deployable yet.

The roadmap is the task list in [`docs/superpowers/plans/2026-10-20-loki.md`](docs/superpowers/plans/2026-10-20-loki.md).

## Development quickstart

Requires Node and Docker.

```sh
cp .env.dev.example .env
docker compose -f docker-compose.dev.yml up -d   # Postgres, MinIO, mock OIDC provider
npm install
npm run dev
```

Run the tests with `npm test`. `.env.dev.example` is the development template; `.env.example` is the production one (see [`docs/deployment.md`](docs/deployment.md)).

For the full design (goals, non-goals, decisions, security, operations), see [`docs/superpowers/specs/`](docs/superpowers/specs/).
