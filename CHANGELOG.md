# Changelog

Release notes per version, newest first. The same notes are on the GitHub Releases page; each release is a tag `vX.Y.Z` and a signed container image.

## v1.10.1 (2026-11-18)

### Changes

* seasonal themes: the Advent theme now switches on **November 22** (Berlin time) instead of December 1, every year; it still ends December 26
* dependencies: npm group bump

### Operations

* no migrations and no new environment variables — pull the image before November 22 so the Advent look is on in time

## v1.10.0 (2026-11-12)

### Features

* feedback: a new Feedback page (Profile → Feedback) mails your message straight to the admins — plain text only, with an optional anonymous mode that keeps your name out of the email entirely. Configured via SMTP environment variables; without them the page simply stays off
* what's new: after every update a small dismissible "New in Loki" card at the top of the feed tells you in plain words what changed
* moderation: admins can end all of a user's sessions (Moderation → Users). The next visit goes through Authentik sign-in again and picks up the current groups, so role changes now take effect immediately instead of when the old session expires

### Operations

* no database migration. New optional environment variables for the feedback mail: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_REQUIRE_TLS, SMTP_USER, SMTP_PASS, MAIL_FROM, FEEDBACK_TO — set SMTP_HOST, MAIL_FROM and FEEDBACK_TO all three to enable the page, or none to keep it off (see docs/deployment.md). SMTP_REQUIRE_TLS defaults to true so credentials are never sent over a connection without STARTTLS
* the dev compose stack gains Mailpit (SMTP :1025, web UI :8025) to catch feedback mails locally
* release routine: each release adds its entry to src/lib/changelog.ts

## v1.9.0 (2026-11-11)

### Features

* house rules acceptance: every member must read and accept the house rules on a new /welcome page before using the board, and again whenever an admin changes them. The server enforces it centrally (pages redirect to /welcome, writes are refused until accepted); the page works without JavaScript, saving unchanged rules does not re-trigger acceptance, and the admin who saves a change counts as having accepted it

### Bug Fixes

* comment sorting: the Top/New toggle moved out of the Comments heading into its own list bar below the composer (comment count on the left, toggle on the right), so it can no longer clip against the heading

### Operations

* one database migration (adds users.rules_accepted_at), applied automatically at boot; no new environment variables. On first start after the upgrade every member is sent to /welcome once to accept the rules.

## v1.8.1 (2026-11-09)

### Bug Fixes

* comment sorting: Top always matches the scores on screen (votes update the list live; the order still never jumps while voting), New lists newest first (replies stay chronological, ties under Top go to the newer comment), and notification links to the comment section no longer clip the sort toggle under the sticky bar

### Operations

* no migrations and no new environment variables

## v1.8.0 (2026-11-09)

### Features

* comments can be edited for five minutes after posting: an Edit action next to Reply for the author's own live comments, a permanent "(edited)" marker with the edit time, mentions stay editable and only newly mentioned members are notified (once per comment); the window is enforced server-side on the database clock

### Operations

* migration 0016 runs at boot and only adds a nullable `comments.edited_at` column — rolling back to 1.7.0 is safe
* no new environment variables

## v1.7.0 (2026-11-09)

### Features

* comments 2.0: threaded replies up to three levels deep (a deleted comment with replies stays as a "[deleted]" placeholder), up- and downvotes on comments, a Top/New sort toggle remembered per browser, @mentions with a member picker that store a stable reference and always show the member's current name, and "replied to your comment" / "mentioned you" notices with deep links and two new notification switches

### Operations

* migrations 0014 and 0015 run at boot: comment threads and votes, the `mention_text()` SQL function and two indexes — **forward-only**: take a database backup before updating, going back to 1.6.0 needs a restore
* comments on the meme page now default to Top (by score) instead of newest first
* no new environment variables

## v1.6.0 (2026-11-01)

### Features

* seasonal header effects: snow for Advent, bats for Halloween, confetti for Carnival and sparkles for the party theme, drawn behind the page header so memes, buttons and text stay uncovered, and parked when the device asks for reduced motion

### Bug Fixes

* pin minimatch to 11 for GHSA-g3hv-75wg-m249 in the lint toolchain

### Operations

* CI runs on the self-hosted runner named by the `RUNNER` repository variable, with GitHub's runner as the fallback; images are still published from GitHub's runner
* no migrations and no new environment variables

## v1.5.0 (2026-10-28)

### Features

* random public ids for memes, members, comments, quotes and templates: every link, API path and page payload uses a 12-character id instead of the sequential database id, numeric ids answer 404, feed and Discover cursors no longer reveal ids, and new uploads use id-free object keys

### Operations

* migration 0013 creates the trusted extension `pgcrypto` and backfills `public_id` on five tables at start; on a managed database where the application role may not create extensions, create `pgcrypto` once by hand first
* old numeric links such as `/meme/42` stop working; existing files in the bucket keep their keys
* no new environment variables

## v1.4.0 (2026-10-28)

### Changes

* Move the profile from the tab bar to the feed header
* Refresh README screenshots for the new navigation
* Cloudflare Tunnel on another host, R2 token creation steps
* Pin CI runners to Ubuntu 26.04

### Operations

* No migrations and no new environment variables. Pull the new image and restart.
* The tab bar no longer has a Profile tab. Members reach their profile, and Sign out, through the avatar at the top right of the feed.

## v1.3.0 (2026-10-28)

### Changes

* English user interface
* Maintenance mode and readiness
* Seasonal and event themes
* Profiles with display names, avatars, mottos and role badges
* In-app notifications with activity and moderation notices
* Search for memes, tags, people, comments and quotes; member pages
* Meme of the month with automatic monthly awards
* Meme generator with template library, canvas captions and remix
* Login styling, blurred-card controls, upload header and small glitches

### Operations

* Migrations 0006 to 0012 run automatically at start. Migration 0010 executes `CREATE EXTENSION IF NOT EXISTS pg_trgm`; the application role must be allowed to create this trusted extension (it is, as database owner in the shipped compose setup). On a managed database create the extension once by hand before deploying.
* New environment variable `AVATAR_MAX_MB` (default 8) caps avatar and template uploads.
* New hourly jobs: the Meme of the Month award and the notification sweep run inside the app, nothing to configure.

## v1.2.0 (2026-10-21)

### Changes
* Moderation: reporting, review queue, timeouts and audit log

## v1.1.1 (2026-10-20)

### Changes
* docs: README screenshots plus a reusable screenshot agent
* chore: restructure compose files and env templates (R2 EU primary)

## v1.1.0 (2026-10-20)

### Changes
* ci: tag-based Docker publishing from release tags
* chore(deps): Bump alpine from 3.22 to 3.24 in /backup
* chore: ignore Node majors for Docker base images in Dependabot
* ci: sign published images with cosign, build PRs amd64-only
* Polish wave: hardening, UX and test backlog from the reviews

## v1.0.1 (2026-10-20)

### Bug Fixes

* exclude the generated CHANGELOG.md from prettier

## v1.0.0 (2026-10-20)

### Features

* add admin-editable rules and faq pages
* add auth-gated media delivery via presigned redirects
* add authentik oidc login with group-based roles
* add card feed with sorting, tag filter and infinite scroll
* add createMedia with cleanup and tag suggest endpoint
* add database schema and migrations
* add encrypted s3 backups with documented restore
* add entdecken fullscreen swipe with unseen-first ordering
* add favorites, deletion and moderation flags with feed filter
* add fullscreen detail with comments, swipe nav and seen tracking
* add German error page and translate vote aria-labels
* add loki icons and favicon, disallow crawlers
* add manual light/dark theme toggle
* add media sniffing and thumbnail/poster processing
* add meme upload with tags, nsfw and spoiler flags
* add meme voting with cached score
* add production dockerfile and compose stack
* add profile pages and wire favorite star and moderation menu
* add quotes with voting and moderator deletion
* add rate limiter and hot score job
* add rate limiting hooks, pwa manifest and share target
* add s3-compatible storage module
* add sessions, global auth guard and security headers
* add statistics page with svg charts
* cap session lifetime with an absolute maximum

### Bug Fixes

* allow inline style attributes in CSP
* allow virtual-host S3 origin in CSP and exempt seen-tracking from the write limit
* bound ffmpeg runtime and report poster extraction failures clearly
* do not print database credentials in restore refusal
* force ffmpeg demuxer and restrict protocols for video posters
* harden backups (backup-dir, max-delete, separate env, healthcheck, restore guards)
* include pending tag input in upload form submission
* let the upload picker offer the gallery, not only the camera
* mark seen only at 60% visibility and keep recent exclude ids
* narrow public asset paths and re-set cookie on session renewal
* point profile statistics link at /profil/statistiken
* require ORIGIN in env and fix mock idp claim mapping
* revoke sessions when a returning user loses all loki groups
* server-render the first feed page and use German tab routes

### Performance Improvements

* lazy-load discover media and play only the active video

