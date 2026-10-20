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
# Deleted/overwritten objects are moved to media-deleted/<stamp>/ instead of being destroyed,
# and a run that would delete more than BACKUP_MAX_DELETE objects aborts (mass-delete guard).
rclone sync "MEDIA:${S3_BUCKET}" VAULT:media/ --backup-dir "VAULT:media-deleted/${STAMP}" \
  --max-delete "${BACKUP_MAX_DELETE:-200}" --fast-list --stats-one-line -v

# Dump and sync succeeded: that is what the healthcheck measures. Retention below is
# best-effort, so a backup token without delete permission must not make every run unhealthy.
touch /var/run/backup.ok

echo "[$STAMP] retention: delete dumps and media-deleted folders older than ${RETENTION}d"
rclone delete VAULT:db/ --min-age "${RETENTION}d" -v \
  || echo "WARN: [$STAMP] pruning old dumps failed (token without delete permission?); old dumps are NOT being removed" >&2
# moved objects keep their original mtime, so prune media-deleted/ by the folder's stamp name
if CUTOFF="$(date -u -d "@$(( $(date +%s) - RETENTION * 86400 ))" +%Y%m%dT%H%M%SZ)"; then
  rclone lsf VAULT:media-deleted/ --dirs-only 2>/dev/null | while read -r d; do
    d="${d%/}"
    if [ -n "$d" ] && [ "$d" \< "$CUTOFF" ]; then
      rclone purge "VAULT:media-deleted/$d" -v \
        || echo "WARN: [$STAMP] pruning media-deleted/$d failed (token without delete permission?); it is NOT being removed" >&2
    fi
  done
else
  echo "WARN: [$STAMP] could not compute the retention cutoff; media-deleted/ is NOT being pruned" >&2
fi

echo "[$STAMP] done"
