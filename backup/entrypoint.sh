#!/bin/sh
# Entrypoint: with `crond` installs the schedule, anything else is exec'd as-is.
set -eu
if [ "${1:-}" = "crond" ]; then
  # cron jobs do not inherit the container environment: persist it for backup.sh
  umask 077
  export -p > /etc/backup.env
  [ -e /var/run/backup.ok ] || touch /var/run/backup.ok # grace period: healthy until the first schedule is missed
  chmod 600 /etc/backup.env
  echo "${BACKUP_CRON:-0 3 * * *} /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
  echo "backup: schedule '${BACKUP_CRON:-0 3 * * *}' (${TZ:-UTC}), retention ${BACKUP_RETENTION_DAYS:-30} days"
  exec crond -f -l 8
fi
exec "$@"
