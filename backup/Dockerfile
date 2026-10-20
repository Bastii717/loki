FROM alpine:3.22
RUN apk add --no-cache postgresql17-client rclone tzdata ca-certificates
COPY lib.sh backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# default: run crond in the foreground; `docker compose run --rm backup backup.sh` runs one backup
CMD ["crond"]
