# Changelog

## [1.7.0](https://github.com/Bastii717/loki/compare/v1.6.0...v1.7.0) (2026-11-09)


### Features

* comments 2.0: threaded replies up to three levels deep (a deleted comment with replies stays as a "[deleted]" placeholder), up- and downvotes on comments, a Top/New sort toggle remembered per browser, @mentions with a member picker that store a stable reference and always show the member's current name, and "replied to your comment" / "mentioned you" notices with deep links and two new notification switches ([#48](https://github.com/Bastii717/loki/pull/48))


### Operations

* migrations 0014 and 0015 run at boot: comment threads and votes, the `mention_text()` SQL function and two indexes — **forward-only**: take a database backup before updating, going back to 1.6.0 needs a restore
* comments on the meme page now default to Top (by score) instead of newest first
* no new environment variables


## [1.6.0](https://github.com/Bastii717/loki/compare/v1.5.0...v1.6.0) (2026-11-01)


### Features

* seasonal header effects: snow for Advent, bats for Halloween, confetti for Carnival and sparkles for the party theme, drawn behind the page header so memes, buttons and text stay uncovered, and parked when the device asks for reduced motion ([#43](https://github.com/Bastii717/loki/pull/43))


### Bug Fixes

* pin minimatch to 11 for GHSA-g3hv-75wg-m249 in the lint toolchain ([#44](https://github.com/Bastii717/loki/pull/44))


### Operations

* CI runs on the self-hosted runner named by the `RUNNER` repository variable, with GitHub's runner as the fallback; images are still published from GitHub's runner ([#42](https://github.com/Bastii717/loki/pull/42))
* no migrations and no new environment variables


## [1.5.0](https://github.com/Bastii717/loki/compare/v1.4.0...v1.5.0) (2026-10-29)


### Features

* random public ids for memes, members, comments, quotes and templates: every link, API path and page payload uses a 12-character id instead of the sequential database id, numeric ids answer 404, feed and Discover cursors no longer reveal ids, and new uploads use id-free object keys ([#41](https://github.com/Bastii717/loki/pull/41))


### Operations

* migration 0013 creates the trusted extension `pgcrypto` and backfills `public_id` on five tables at start; on a managed database where the application role may not create extensions, create `pgcrypto` once by hand first
* old numeric links such as `/meme/42` stop working; existing files in the bucket keep their keys
* no new environment variables


## [1.4.0](https://github.com/Bastii717/loki/compare/v1.3.0...v1.4.0) (2026-10-28)


### Features

* move the profile from the tab bar to the feed header: the tab bar is Feed, Discover, post button, Quotes and Alerts, the feed header shows the viewer's avatar with the open-reports count for moderators, and Sign out lives on the profile page ([#39](https://github.com/Bastii717/loki/pull/39))


### Documentation

* Cloudflare Tunnel on another host and R2 token creation steps ([#38](https://github.com/Bastii717/loki/pull/38))
* README screenshots refreshed for the new navigation ([#40](https://github.com/Bastii717/loki/pull/40))


### Operations

* CI runners pinned to Ubuntu 26.04 ([#37](https://github.com/Bastii717/loki/pull/37))
* no migrations and no new environment variables


## [1.3.0](https://github.com/Bastii717/loki/compare/v1.2.0...v1.3.0) (2026-10-28)


### Features

* english user interface ([#27](https://github.com/Bastii717/loki/pull/27))
* maintenance mode and readiness ([#28](https://github.com/Bastii717/loki/pull/28))
* seasonal and event themes ([#31](https://github.com/Bastii717/loki/pull/31))
* profiles with display names, avatars, mottos and role badges ([#32](https://github.com/Bastii717/loki/pull/32))
* in-app notifications with activity and moderation notices ([#33](https://github.com/Bastii717/loki/pull/33))
* search for memes, tags, people, comments and quotes; member pages ([#34](https://github.com/Bastii717/loki/pull/34))
* meme of the month with automatic monthly awards ([#35](https://github.com/Bastii717/loki/pull/35))
* meme generator with template library, canvas captions and remix ([#36](https://github.com/Bastii717/loki/pull/36))


### Bug Fixes

* login styling, blurred-card controls, upload header and small glitches ([#26](https://github.com/Bastii717/loki/pull/26))


### Operations

* migrations 0006 to 0012 run automatically at start (maintenance switch, season settings, user profiles, notifications, awards, trigram search with the `pg_trgm` extension, templates)
* new environment variable `AVATAR_MAX_MB` (default 8), see `docs/deployment.md`


## [1.0.1](https://github.com/Bastii717/loki/compare/v1.0.0...v1.0.1) (2026-10-20)


### Bug Fixes

* exclude release-please CHANGELOG.md from prettier ([d00811f](https://github.com/Bastii717/loki/commit/d00811f23e6a9c456646423ad5a344415dd5fac3))

## 1.0.0 (2026-10-20)


### Features

* add admin-editable rules and faq pages ([3e80bd9](https://github.com/Bastii717/loki/commit/3e80bd91045db88a51d685cac5009e2a7c1cab89))
* add auth-gated media delivery via presigned redirects ([5790c8a](https://github.com/Bastii717/loki/commit/5790c8a7ca60ed2412aca7d87a97b509defc30b3))
* add authentik oidc login with group-based roles ([d085e76](https://github.com/Bastii717/loki/commit/d085e7644e3f28a073b78482448e1a36726d62f8))
* add card feed with sorting, tag filter and infinite scroll ([507be0b](https://github.com/Bastii717/loki/commit/507be0bcfa952f637e1920c4546ecf1913a10256))
* add createMedia with cleanup and tag suggest endpoint ([b9b2a17](https://github.com/Bastii717/loki/commit/b9b2a17e2cf743a9a365271b31477413f9713e15))
* add database schema and migrations ([7dffcd1](https://github.com/Bastii717/loki/commit/7dffcd17753cf0ff5b84c1a4901a67141f63c1d7))
* add encrypted s3 backups with documented restore ([c92a479](https://github.com/Bastii717/loki/commit/c92a4791b0fb525202c03e322f2e9259a8cd0547))
* add entdecken fullscreen swipe with unseen-first ordering ([9507384](https://github.com/Bastii717/loki/commit/9507384621c567f6b8171e49d35892a4b6df5aea))
* add favorites, deletion and moderation flags with feed filter ([4d67d49](https://github.com/Bastii717/loki/commit/4d67d49e530f1c78f6ff8baace3ab0d5c877c15e))
* add fullscreen detail with comments, swipe nav and seen tracking ([4a4f841](https://github.com/Bastii717/loki/commit/4a4f841b5dcb0ae12dac32d0c6d088e8b1a41668))
* add German error page and translate vote aria-labels ([6ba531f](https://github.com/Bastii717/loki/commit/6ba531ffbb5d32282fce04828205f3170e445121))
* add loki icons and favicon, disallow crawlers ([cdcfac6](https://github.com/Bastii717/loki/commit/cdcfac609cd707bafe2c925c41561b69fbc8e05a))
* add manual light/dark theme toggle ([b879981](https://github.com/Bastii717/loki/commit/b879981e8f53169cb74ce1b2492b8bf2fa1e1d5b))
* add media sniffing and thumbnail/poster processing ([00a7496](https://github.com/Bastii717/loki/commit/00a7496583b200cace48577f48ab8f88e21f9adf))
* add meme upload with tags, nsfw and spoiler flags ([bec90de](https://github.com/Bastii717/loki/commit/bec90de7fe8b9c50e2d0d9a15935d7c882089b3d))
* add meme voting with cached score ([80a2b3d](https://github.com/Bastii717/loki/commit/80a2b3d7f9740de6f28096ac84241d79c5140c6b))
* add production dockerfile and compose stack ([30e6ce2](https://github.com/Bastii717/loki/commit/30e6ce2dd9ca1c37f3700ba3c06cfd52d5f509ae))
* add profile pages and wire favorite star and moderation menu ([39e345e](https://github.com/Bastii717/loki/commit/39e345e82c03e7051cb4c4f0ff900c46b3903a87))
* add quotes with voting and moderator deletion ([a9e8eb6](https://github.com/Bastii717/loki/commit/a9e8eb6741a6c7036a6c5e5f2760d5f1c646af91))
* add rate limiter and hot score job ([c15a3c4](https://github.com/Bastii717/loki/commit/c15a3c437f0b5d45e3caa6878a00651c1c7c39ef))
* add rate limiting hooks, pwa manifest and share target ([6592eb7](https://github.com/Bastii717/loki/commit/6592eb7306d33df9232bf4f7bc2266c789dcfe12))
* add s3-compatible storage module ([d67b99f](https://github.com/Bastii717/loki/commit/d67b99f08cf87fdd6eac4baf82e79195787f617a))
* add sessions, global auth guard and security headers ([c645ae9](https://github.com/Bastii717/loki/commit/c645ae9c674affc14027ad53845951b3c2fa73a6))
* add statistics page with svg charts ([2b54721](https://github.com/Bastii717/loki/commit/2b54721ea8c30958c4b0639253c1cd3d5873b120))
* cap session lifetime with an absolute maximum ([242c438](https://github.com/Bastii717/loki/commit/242c438b2d66fcdb90e951aacce5f2e1ea82a010))


### Bug Fixes

* allow inline style attributes in CSP ([d2d0235](https://github.com/Bastii717/loki/commit/d2d02350fa441299dcc096508db52bc759d3a9ba))
* allow virtual-host S3 origin in CSP and exempt seen-tracking from the write limit ([a016090](https://github.com/Bastii717/loki/commit/a016090d721425ba5fbbc8598d408f4e8f631787))
* bound ffmpeg runtime and report poster extraction failures clearly ([ef853b9](https://github.com/Bastii717/loki/commit/ef853b99302d86839819520f8057b57a0cb3d419))
* do not print database credentials in restore refusal ([f661e94](https://github.com/Bastii717/loki/commit/f661e94af834a1318feb44883572042be8d4d66d))
* force ffmpeg demuxer and restrict protocols for video posters ([c0bbecd](https://github.com/Bastii717/loki/commit/c0bbecd87e5766e24394a711a349e9635af10c1e))
* harden backups (backup-dir, max-delete, separate env, healthcheck, restore guards) ([e8ed516](https://github.com/Bastii717/loki/commit/e8ed51611598bb7c4261c5d8ae3946d2b447db90))
* include pending tag input in upload form submission ([bf6e035](https://github.com/Bastii717/loki/commit/bf6e035a2e81ca585ae8bf64902e6480bccc5321))
* let the upload picker offer the gallery, not only the camera ([9a7a037](https://github.com/Bastii717/loki/commit/9a7a037ae98b5cdd4024e0707c813be838052469))
* mark seen only at 60% visibility and keep recent exclude ids ([36a2f94](https://github.com/Bastii717/loki/commit/36a2f94a382b39b0f0b866e5c710c1646b66c974))
* narrow public asset paths and re-set cookie on session renewal ([456598e](https://github.com/Bastii717/loki/commit/456598e4428b5e4b5ffb95c9726aa439e3d7b8e7))
* point profile statistics link at /profil/statistiken ([2fa8cbe](https://github.com/Bastii717/loki/commit/2fa8cbee032fa81a3e531fb963a7fb41291a8d78))
* require ORIGIN in env and fix mock idp claim mapping ([96fed07](https://github.com/Bastii717/loki/commit/96fed07876f50eb7f90d8bc302554dcecd652e35))
* revoke sessions when a returning user loses all loki groups ([0d699b6](https://github.com/Bastii717/loki/commit/0d699b60a1a73eb0f76a258757ef7d47aea05b2a))
* server-render the first feed page and use German tab routes ([5ffbcac](https://github.com/Bastii717/loki/commit/5ffbcacc47bef8d3700462b5d46559ddb9156a22))


### Performance Improvements

* lazy-load discover media and play only the active video ([51130e2](https://github.com/Bastii717/loki/commit/51130e2ad1e411b76eef70691aff8cdbf27e4e0b))
