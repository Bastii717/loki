#!/bin/sh
# Encrypted backup of Postgres + media bucket to an rclone crypt remote on a separate S3 bucket.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env

: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
: "${BACKUP_CRYPT_PASSWORD:?}" "${BACKUP_CRYPT_SALT:?}"
: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
: "${BACKUP_DATABASE_URL:=${DATABASE_URL:?set DATABASE_URL or BACKUP_DATABASE_URL}}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
. /usr/local/bin/lib.sh

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="/tmp/loki-$STAMP.dump"
trap 'rm -f "$DUMP"' EXIT

echo "[$STAMP] pg_dump"
pg_dump -Fc --no-owner --dbname "$BACKUP_DATABASE_URL" -f "$DUMP"

echo "[$STAMP] upload dump"
rclone copy "$DUMP" VAULT:db/

echo "[$STAMP] sync media"
rclone sync "MEDIA:${S3_BUCKET}" VAULT:media/ --fast-list --stats-one-line -v

echo "[$STAMP] retention: delete dumps older than ${RETENTION}d"
rclone delete VAULT:db/ --min-age "${RETENTION}d" -v

echo "[$STAMP] done"
