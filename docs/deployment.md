# Deployment

Loki ships as one container image (`ghcr.io/bastii717/loki`) plus Postgres. Media lives in
S3-compatible storage (Cloudflare R2 in production). TLS is **not** terminated by Loki: it is
terminated by either a Cloudflare Tunnel or an external nginx.

The container runs as the non-root `node` user, listens on port 3000, exposes `/healthz`
(used by the image `HEALTHCHECK`) and applies database migrations on startup.

## Quick start

1. Copy `.env.example` to `.env` and fill it in (see below).
2. `docker compose -f compose.prod.yml pull && docker compose -f compose.prod.yml up -d`
3. Publish the app through a Cloudflare Tunnel or nginx (see "Publishing").

Build the image yourself with `docker build -t ghcr.io/bastii717/loki:latest .`.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `ORIGIN` | yes | Public URL, e.g. `https://loki.example.com` (no trailing slash). Used for CSRF checks and the OIDC redirect URI. |
| `SESSION_SECRET` | yes | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | compose | Password of the bundled `db` service; compose derives `DATABASE_URL` from it. |
| `DATABASE_URL` | yes (non-compose) | Overridden by `compose.prod.yml` to point at the `db` service. |
| `S3_ENDPOINT` | yes | R2: `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | yes | Private bucket name |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | yes | R2 API token (Object Read & Write, scoped to the bucket) |
| `S3_REGION` | no | `auto` for R2 |
| `S3_FORCE_PATH_STYLE` | no | `false` for R2, `true` for MinIO |
| `OIDC_ISSUER` | yes | Authentik: `https://auth.example.com/application/o/<slug>/` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | yes | From the Authentik provider |
| `OIDC_GROUPS_CLAIM` | no | Default `groups` |
| `OIDC_GROUP_MEMBERS` / `OIDC_GROUP_MODS` / `OIDC_GROUP_ADMINS` | no | Defaults `loki-members`, `loki-mods`, `loki-admins` |
| `MAX_UPLOAD_MB` | no | Default 50 |
| `AUTO_BLUR_SCORE` | no | Default -3 |
| `SESSION_ABSOLUTE_MAX_DAYS` | no | Default 90 |
| `BODY_SIZE_LIMIT` | yes in practice | adapter-node rejects larger request bodies (default 512K). Must be at least `MAX_UPLOAD_MB`, e.g. `60M`. |
| `PROTOCOL_HEADER` | behind proxy | `x-forwarded-proto` |
| `HOST_HEADER` | behind proxy | `x-forwarded-host` |
| `ADDRESS_HEADER` | behind proxy | `x-forwarded-for` (client IP, used for rate limiting). Only set it when a trusted proxy overwrites that header. |
| `TUNNEL_TOKEN` | tunnel only | Cloudflare Tunnel token for the `cloudflared` sidecar |

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

The `backup` service in `compose.prod.yml` is commented out by default; uncomment it after creating `backup.env`. Operations and restore procedure: [`backup/README.md`](../backup/README.md).

## Authentik setup

1. Create groups `loki-members`, `loki-mods`, `loki-admins` (names must match the `OIDC_GROUP_*` variables) and add users. Members may log in; mods and admins gain the respective roles.
2. Create an **OAuth2/OpenID Provider**: client type *Confidential*, redirect URI (strict) `${ORIGIN}/auth/callback`, scopes `openid`, `profile`, `email`.
3. Make sure the **ID token contains the groups claim**: add or keep the `groups` scope mapping (Authentik's default "profile" mapping exposes `groups`) and tick *Include claims in id_token*. The claim name must equal `OIDC_GROUPS_CLAIM`.
4. Create an **Application** bound to the provider, then restrict access to the three groups with policy bindings if desired.
5. Copy the client ID/secret into `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` and set `OIDC_ISSUER` to the provider's issuer URL (with trailing slash, `.../application/o/<slug>/`).

## Cloudflare R2

1. Create a bucket (R2 > Create bucket). Leave it private.
2. **Never attach a public custom domain, and never enable the `r2.dev` public URL, on this bucket.** Media is served only through short-lived presigned URLs issued by the app; a public bucket would expose every upload, including content that has been removed or blurred.
3. Create an R2 API token with Object Read & Write limited to this bucket; use its keys as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
4. Set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`.
5. The app sets `requestChecksumCalculation`/`responseChecksumValidation` to `WHEN_REQUIRED` because R2 rejects the SDK's default CRC32 checksums.

To self-host storage instead, uncomment the `minio` block in `compose.prod.yml` and follow the comments there.

## Publishing

TLS terminates in front of the container; in both cases set `ORIGIN` to the public https URL,
`PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`, and
`BODY_SIZE_LIMIT` >= `MAX_UPLOAD_MB`.

### Option A: Cloudflare Tunnel

1. Zero Trust > Networks > Tunnels: create a tunnel, copy its token into `TUNNEL_TOKEN` in `.env`.
2. Add a public hostname pointing at `http://app:3000`.
3. In `compose.prod.yml` uncomment the `cloudflared` service and remove the `ports:` entry of `app` so nothing is published on the host.
4. `ADDRESS_HEADER`: cloudflared forwards the client IP in `x-forwarded-for` (`cf-connecting-ip` also works). Set `ADDRESS_HEADER=x-forwarded-for`.

### Option B: external nginx

The `app` service publishes `127.0.0.1:3000`. Example server block (certificates via certbot or your own):

```nginx
server {
    listen 443 ssl http2;
    server_name loki.example.com;

    ssl_certificate     /etc/letsencrypt/live/loki.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/loki.example.com/privkey.pem;

    # must be at least MAX_UPLOAD_MB (plus multipart overhead)
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
    }
}

server {
    listen 80;
    server_name loki.example.com;
    return 301 https://$host$request_uri;
}
```

Set `ADDRESS_HEADER=x-forwarded-for`. nginx overwrites the header with `$remote_addr` as above, so clients cannot spoof it.

## Operations

- Health: `curl http://127.0.0.1:3000/healthz` returns `ok`.
- Update: `docker compose -f compose.prod.yml pull && docker compose -f compose.prod.yml up -d` (migrations run on start).
- Postgres data lives in the `db-data` volume.
