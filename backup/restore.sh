#!/bin/sh
# Restore into the stack described by DATABASE_URL / S3_* (same env contract as backup.sh).
# RESTORE_DUMP=<file name> picks a dump; default is the newest one.
set -eu
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
: "${BACKUP_CRYPT_PASSWORD:?}" "${BACKUP_CRYPT_SALT:?}"
: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
: "${DATABASE_URL:?}"
. /usr/local/bin/lib.sh

DUMP_NAME="${RESTORE_DUMP:-$(rclone lsf VAULT:db/ | sort | tail -n 1)}"
[ -n "$DUMP_NAME" ] || { echo "no dump found in VAULT:db/" >&2; exit 1; }
echo "restoring database from $DUMP_NAME"
rclone copy "VAULT:db/$DUMP_NAME" /tmp/
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "/tmp/$DUMP_NAME"
rm -f "/tmp/$DUMP_NAME"

echo "restoring media into ${S3_BUCKET}"
rclone sync VAULT:media/ "MEDIA:${S3_BUCKET}" --fast-list --stats-one-line -v
echo "restore done"
