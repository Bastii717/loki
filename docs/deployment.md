# Deployment

Loki ships as one container image (`ghcr.io/bastii717/loki`) plus Postgres. Media lives in
S3-compatible storage (Cloudflare R2 in production). TLS is **not** terminated by Loki: it is
terminated by either a Cloudflare Tunnel or an external nginx.

The container runs as the non-root `node` user, listens on port 3000, exposes `/healthz`
(used by the image `HEALTHCHECK`) and applies database migrations on startup.

## Quick start

1. Copy `.env.example` (the production template; local development uses `.env.dev.example`) to `.env` and fill it in (see below).
2. `docker compose pull && docker compose up -d`
3. Publish the app through a Cloudflare Tunnel or nginx (see "Publishing").

Build the image yourself with `docker build -t ghcr.io/bastii717/loki:latest .`.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `ORIGIN` | yes | Public URL, e.g. `https://loki.example.com` (no trailing slash). Used for the OIDC redirect URI. adapter-node ignores it: SvelteKit's CSRF check compares the `Origin` header with the origin built from `PROTOCOL_HEADER`/`HOST_HEADER` (default protocol `https`), so set those behind a proxy. |
| `POSTGRES_PASSWORD` | compose | Password of the bundled `db` service; compose derives `DATABASE_URL` from it. |
| `DATABASE_URL` | yes (non-compose) | Overridden by `docker-compose.yml` to point at the `db` service. |
| `S3_ENDPOINT` | yes | R2 (EU jurisdiction): `https://<account-id>.eu.r2.cloudflarestorage.com` |
| `S3_BUCKET` | yes | Private bucket name |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | yes | R2 API token (Object Read & Write, scoped to the bucket) |
| `S3_REGION` | no | `auto` for R2 |
| `S3_FORCE_PATH_STYLE` | no | `false` for R2, `true` for MinIO |
| `OIDC_ISSUER` | yes | Authentik: `https://auth.example.com/application/o/<slug>/` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | yes | From the Authentik provider |
| `OIDC_GROUPS_CLAIM` | no | Default `groups` |
| `OIDC_GROUP_MEMBERS` / `OIDC_GROUP_MODS` / `OIDC_GROUP_ADMINS` | no | Defaults `loki-members`, `loki-mods`, `loki-admins` |
| `MAX_UPLOAD_MB` | no | Default 50 |
| `AVATAR_MAX_MB` | no | Default 8. Largest accepted profile picture before it is resized. |
| `AUTO_BLUR_SCORE` | no | Default -3 |
| `SESSION_ABSOLUTE_MAX_DAYS` | no | Default 90 |
| `REPORT_REVIEW_THRESHOLD` | no | Default 3 (integer >= 1). Content is hidden from members pending moderator review once MORE than this many distinct members (reporters with an active timeout do not count) have an open report on it; moderators and admins always see it. A moderator releasing a case makes the item permanently immune to auto-hiding. |
| `BODY_SIZE_LIMIT` | yes in practice | adapter-node rejects larger request bodies (default 512K). Must be at least `MAX_UPLOAD_MB`, e.g. `60M`. |
| `PROTOCOL_HEADER` | behind proxy | `x-forwarded-proto` |
| `HOST_HEADER` | behind proxy | `x-forwarded-host` |
| `ADDRESS_HEADER` | behind proxy | `x-forwarded-for` (client IP, used for rate limiting). Only set it when a trusted proxy overwrites that header. |
| `TUNNEL_TOKEN` | tunnel only | Cloudflare Tunnel token for the `cloudflared` sidecar |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | minio fallback only | Root credentials of the optional `minio` service; reuse them as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` |

### Backup variables (`backup.env`, not `.env`)

The `backup` service reads its own `backup.env` (template: `backup.env.example`), never `.env`. Reason: `.env` is loaded by the `app` container; if the backup credentials or crypt keys lived there, a compromised app could read, delete or decrypt the backups, and the backup job would in turn receive secrets it does not need (OIDC, session secret). Rules:

- The backup bucket uses its **own credentials, scoped to that bucket only**. The app's `S3_*` token must have **no access** to the backup bucket.
- Give the backup job a **read-only token for the media bucket** (`S3_*` in `backup.env`), not the app's read/write token.
- `BACKUP_CRYPT_PASSWORD` / `BACKUP_CRYPT_SALT` are kept outside the server too (password manager): without them backups cannot be decrypted.

| Variable | Required | Meaning |
| --- | --- | --- |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | backups | Media bucket to back up (read-only token recommended) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION` | backups | Separate backup bucket and its credentials |
| `BACKUP_CRYPT_PASSWORD` / `BACKUP_CRYPT_SALT` | backups | rclone crypt keys |
| `BACKUP_CRON` | no | Schedule, default `0 3 * * *` |
| `BACKUP_RETENTION_DAYS` | no | Dumps and `media-deleted/` folders older than this are removed, default `30` |
| `BACKUP_MAX_DELETE` | no | A run that would delete more than this many media objects from the mirror aborts, default `200` |
| `BACKUP_MAX_AGE_HOURS` | no | Container healthcheck turns unhealthy when no backup succeeded for this long, default `48` |

The `backup` service in `docker-compose.yml` is commented out by default; uncomment it after creating `backup.env`. Operations and restore procedure: [`backup/README.md`](../backup/README.md).

## Authentik setup

1. Create groups `loki-members`, `loki-mods`, `loki-admins` (names must match the `OIDC_GROUP_*` variables) and add users. Members may log in; mods and admins gain the respective roles.
2. Create an **OAuth2/OpenID Provider**: client type *Confidential*, redirect URI (strict) `${ORIGIN}/auth/callback`, scopes `openid`, `profile`, `email`.
3. Make sure the **ID token contains the groups claim**: add or keep the `groups` scope mapping (Authentik's default "profile" mapping exposes `groups`) and tick *Include claims in id_token*. The claim name must equal `OIDC_GROUPS_CLAIM`.
4. Create an **Application** bound to the provider, then restrict access to the three groups with policy bindings if desired.
5. Copy the client ID/secret into `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` and set `OIDC_ISSUER` to the provider's issuer URL (with trailing slash, `.../application/o/<slug>/`).

## Cloudflare R2

1. Create the bucket in the **EU jurisdiction**: R2 > Create bucket > *Specify jurisdiction* > **European Union (EU)**. Leave it private. The jurisdiction (unlike a location hint) guarantees the data is stored and processed only in the EU, and it cannot be changed after creation. Create the backup bucket the same way.
2. **Never attach a public custom domain, and never enable the `r2.dev` public URL, on this bucket.** Media is served only through short-lived presigned URLs issued by the app; a public bucket would expose every upload, including content that has been removed or blurred.
3. Create an R2 API token with Object Read & Write limited to this bucket (select the EU jurisdiction when scoping it); use its keys as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
4. Set `S3_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com` (note the `.eu.`; EU buckets are not reachable through the default endpoint), `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`.
5. The app sets `requestChecksumCalculation`/`responseChecksumValidation` to `WHEN_REQUIRED` because R2 rejects the SDK's default CRC32 checksums.

To self-host storage instead, uncomment the `minio` block in `docker-compose.yml` and follow the comments there.

## Publishing

TLS terminates in front of the container; in both cases set `ORIGIN` to the public https URL,
`PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`, and
`BODY_SIZE_LIMIT` >= `MAX_UPLOAD_MB` (`docker-compose.yml` defaults it to `60M`). With nginx,
`client_max_body_size` must match it, otherwise nginx answers 413 before the app sees the upload.

### Option A: Cloudflare Tunnel

1. Zero Trust > Networks > Tunnels: create a tunnel, copy its token into `TUNNEL_TOKEN` in `.env`.
2. Add a public hostname pointing at `http://app:3000`.
3. In `docker-compose.yml` uncomment the `cloudflared` service and remove the `ports:` entry of `app` so nothing is published on the host.
4. `ADDRESS_HEADER`: cloudflared forwards the client IP in `x-forwarded-for` (`cf-connecting-ip` also works). Set `ADDRESS_HEADER=x-forwarded-for`.

### Option B: external nginx

The `app` service publishes `127.0.0.1:3000`. Example server block (certificates via certbot or your own):

```nginx
server {
    listen 443 ssl http2;
    server_name loki.example.com;

    ssl_certificate     /etc/letsencrypt/live/loki.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/loki.example.com/privkey.pem;

    # must be at least MAX_UPLOAD_MB (plus multipart overhead) and match BODY_SIZE_LIMIT
    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_request_buffering off;
        proxy_read_timeout 120s;

        # outage page when the app container is down or restarting (see "Maintenance and readiness")
        error_page 502 504 /maintenance.html;
    }

    location = /maintenance.html {
        root /srv/loki;
        internal;
    }
}

server {
    listen 80;
    server_name loki.example.com;
    return 301 https://$host$request_uri;
}
```

Set `ADDRESS_HEADER=x-forwarded-for`. nginx overwrites the header with `$remote_addr` as above, so clients cannot spoof it.

Copy `static/maintenance.html` from the repository to `/srv/loki/maintenance.html` on the host so nginx can serve it when the container does not answer. Keep `proxy_intercept_errors` off (its default): the app's own 503 responses, with their messages, must reach the browser instead of being replaced by this file.

## Maintenance and readiness

The app is always in one of five states: **ok**, **announced** (maintenance is scheduled and reading keeps working), **maintenance** (admins write, everyone else reads), **not ready** (the storage probe fails, so writes are refused) and **down** (the database is unreachable or migrations are pending, so the app answers every page with a 503 outage page). The first three follow the switch and the schedule; the last two follow the readiness checks.

Admins control the switch on the page **Moderation > Maintenance** (`/moderation/maintenance`): an on/off toggle, a message, and an optional start and end time in Berlin time. While maintenance is on, the app shows a status banner to everyone, disables the write controls and refuses writes server-side, except for admins, who see a short addendum and can keep working. A switch with an end time in the past counts as off. "Switch off now" clears it at once.

Two probes are available without logging in:

- `/healthz` is liveness: it answers `ok` as long as the Node process runs. The image's `HEALTHCHECK` uses it.
- `/readyz` is readiness: it answers 200 with `{ "ready": true, ... }` only when the database answers, the migrations have been applied and the storage bucket is reachable, otherwise 503. The body holds booleans only. `docker-compose.yml` uses it for the `app` health check (every 30 s, 60 s start period, 3 retries), so `docker compose ps` shows `unhealthy` while a dependency is missing. Results are cached for about 10 seconds.

The storage probe is a `HeadObject` request for the key `.loki-readiness-probe` in the bucket. A 2xx or a 404 (the object does not exist, which is the normal case) means the bucket is reachable and counts as ready; any other answer, including 403, or no answer within 3 seconds counts as not ready. Nothing is written. The R2 token needs object read permission for this; the documented Object Read & Write token is enough.

When the container itself does not answer, nginx can still show the outage page: see the `error_page 502 504` lines in [Option B](#option-b-external-nginx) above. Cloudflare Tunnel on the free plan cannot serve a custom page when the origin is down; visitors get the tunnel's default error page. The page the app serves covers every case where the container answers, such as a database outage or pending migrations.

## Operations

- Health: `curl http://127.0.0.1:3000/healthz` returns `ok`.
- Update: `docker compose pull && docker compose up -d` (migrations run on start).
- Postgres data lives in the `db-data` volume.

### Seasonal themes

Three event themes switch on by date in Berlin time, without any environment variable or deployment step: Halloween (October 25 to November 1), Advent (December 1 to December 26) and Carnival (Weiberfastnacht to Ash Wednesday). Admins can force any theme, including the `party` theme, or switch seasons off on the page **Moderation > Theme** (`/moderation/theme`). To preview a theme without changing it for anyone else, an admin adds `?season=<id>` to any URL (for example `/?season=halloween`); the preview applies to pages loaded with that parameter, is not stored, and ends with the next navigation without it.

### Profiles

Members edit their profile at `/profile/edit`: a display name of 2 to 24 characters (changeable once every 30 days), an avatar (JPEG, PNG or WebP, up to `AVATAR_MAX_MB` MB, default 8; it is resized to 256 and 64 pixel WebP files) and a motto of up to 80 characters. Moderators and admins show a shield or shield-check badge next to their name on cards, the detail view, comments and Discover. Admins are not bound by the 30-day rule and manage profiles on **Moderation > Users** (`/moderation/users`): they can rename a member, reset a name to the username, remove an avatar and clear a motto. Every one of these changes, by members and admins alike, is written to the audit log.

## Releases

The `Docker` workflow builds the image for every pull request (without pushing) and publishes it on pushes to `main` and on release tags:

- push to `main`: `ghcr.io/bastii717/loki:main`
- tag `v1.2.3`: `ghcr.io/bastii717/loki:1.2.3`, `:1.2`, `:v1` and `:latest`

To release, tag a commit on `main` and push the tag, or create a release with a new `v*.*.*` tag in the GitHub UI:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

### Image signatures

Every published image is signed with [cosign](https://docs.sigstore.dev/) (keyless: the signing identity is this repo's `Docker` workflow via GitHub OIDC, recorded in the Rekor transparency log). Images published before v1.1.0 are unsigned. Verify a pulled image with:

```bash
cosign verify ghcr.io/bastii717/loki:latest \
  --certificate-identity-regexp 'https://github\.com/Bastii717/loki/\.github/workflows/docker_publish\.yml@refs/(heads/main|tags/v.*)' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## PWA share target

`POST /share` (the Android share sheet) is a multipart form POST, so SvelteKit's CSRF check
applies: it is rejected with 403 when the `Origin` header is missing or `null`, and accepted
when it equals the app's own origin. Verified against a production build (`node build`);
`trustedOrigins` is deliberately not widened. The share target therefore requires the browser
to send an `Origin` header with the public URL when sharing (Chrome on Android does, as far as
we know; verify on real devices). If sharing keeps failing with 403, that is an operator
decision, not a configuration error.

