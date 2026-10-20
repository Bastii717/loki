FROM alpine:3.24
RUN apk add --no-cache postgresql17-client rclone tzdata ca-certificates
COPY lib.sh backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# default: run crond in the foreground; `docker compose run --rm backup backup.sh` runs one backup
CMD ["crond"]
# unhealthy when no backup succeeded within BACKUP_MAX_AGE_HOURS (default 48 = 2x the daily default)
HEALTHCHECK --interval=15m --timeout=10s --start-period=1m CMD \
  find /var/run/backup.ok -mmin -$(( ${BACKUP_MAX_AGE_HOURS:-48} * 60 )) | grep -q .
