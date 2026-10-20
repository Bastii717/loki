# Backups and restore runbook

What is backed up, nightly by the `backup` service (`compose.prod.yml`, commented out by default; see `docs/deployment.md` for the variables):

| What         | How                                          | Where (inside the backup bucket, through the rclone crypt remote `VAULT:`)                                               |
| ------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Postgres     | `pg_dump -Fc` to `loki-<UTC timestamp>.dump` | `VAULT:db/` (copied, never synced; dumps older than `BACKUP_RETENTION_DAYS`, default 30, are deleted)                    |
| Media bucket | `rclone sync` of `S3_BUCKET`                 | `VAULT:media/` (a mirror: files deleted in the app disappear from the mirror on the next run, the dumps are the history) |

The backup bucket is a separate bucket with separate credentials (`BACKUP_S3_*`). Everything in it, file names included, is encrypted client-side with rclone crypt (`BACKUP_CRYPT_PASSWORD`, `BACKUP_CRYPT_SALT`). **Keep both values outside the server: without them the backups are unreadable.**

Files: `Dockerfile` (alpine, `postgresql17-client`, `rclone`), `backup.sh`, `restore.sh`, `lib.sh` (remote setup), `entrypoint.sh` (installs the crontab from `BACKUP_CRON` and runs `crond`).

## Operations (production)

Enable: uncomment `backup:` in `compose.prod.yml`, set the `BACKUP_*` variables in `.env`, then

```sh
docker compose -f compose.prod.yml up -d --build backup
docker compose -f compose.prod.yml logs backup          # "backup: schedule '0 3 * * *' ..."
docker compose -f compose.prod.yml exec backup backup.sh   # run one backup right now
```

List what is in the vault (decrypted view) from inside the container:

```sh
docker compose -f compose.prod.yml exec backup sh -c '. /usr/local/bin/lib.sh; rclone lsf VAULT:db/'
```

## Restore

Prerequisite: a target stack with an **empty** Postgres (database `loki` exists) and an empty media bucket, plus the `BACKUP_*` values (including the crypt keys). Restoring overwrites tables (`pg_restore --clean --if-exists`) and makes the target bucket equal to the backup (`rclone sync`).

1. Bring up the target stack's `db` (and `minio` if self-hosted); do not start `app` yet.
2. Make sure the target media bucket exists (R2: create it; MinIO: `rclone mkdir`).
3. Run `restore.sh` from the backup image with the **target's** `DATABASE_URL` and `S3_*` plus the `BACKUP_*` values of the backup bucket. `RESTORE_DUMP=<file>` selects a dump, the default is the newest.

```sh
docker build -t loki-backup:local ./backup
docker run --rm --network <target compose network> \
  -e DATABASE_URL=postgres://loki:$POSTGRES_PASSWORD@db:5432/loki \
  -e S3_ENDPOINT=$S3_ENDPOINT -e S3_BUCKET=$S3_BUCKET \
  -e S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID -e S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY \
  -e BACKUP_S3_ENDPOINT=$BACKUP_S3_ENDPOINT -e BACKUP_S3_BUCKET=$BACKUP_S3_BUCKET \
  -e BACKUP_S3_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_ACCESS_KEY \
  -e BACKUP_CRYPT_PASSWORD=$BACKUP_CRYPT_PASSWORD -e BACKUP_CRYPT_SALT=$BACKUP_CRYPT_SALT \
  loki-backup:local restore.sh
```

4. Start `app`, log in, open a meme.

Manual equivalent of `restore.sh` (e.g. for a single table or a point-in-time dump): `rclone lsf VAULT:db/`, `rclone copy VAULT:db/<file> /tmp/`, `pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" /tmp/<file>`, `rclone sync VAULT:media/ MEDIA:$S3_BUCKET` (remotes as defined in `lib.sh`).

## Restore drill (executed once against the dev stack)

Performed on 2026-10-20. Source: the dev compose project `loki-dev` (Postgres `loki`, MinIO bucket `loki`, 104 objects / 416.7 KiB of memes left by earlier development runs, so no seeding was needed). The `media` table of that dev database is empty (the bucket objects are orphans), so the database check uses the other tables and a checksum over all rows. Stand-in backup bucket: `loki-backup` on the same dev MinIO. Restore target: a fresh compose project `loki-restore` (own Postgres 17, own MinIO). The crypt keys below are throwaway drill values. Long `-e` lists are abbreviated as `<env>`; the environment was exactly the one shown in "Restore" above, pointing at the dev stack (backup) or at `loki-restore` (restore). Commands ran on a remote Docker host (`DOCKER_HOST=ssh://dev-host`).

The first backup run copied all 104 media objects (`Copied (new)` for each, 421.600 KiB incl. the dump) into the vault; the transcript below is from a repeat run, hence "nothing to transfer" for media (rclone sync is incremental).

```text
$ docker build -t loki-backup:local ./backup
Successfully built 5b433eda3c45
Successfully tagged loki-backup:local

## source state
$ docker exec loki-dev-db-1 psql -U loki -d loki -Atc "select 'users',count(*) ... union all ... 'sessions'"
media|0
sessions|1
tags|1
users|1
$ rclone size m:loki            # m: = dev MinIO admin remote
Total objects: 104
Total size: 416.725 KiB (426726 Byte)

## backup (one run, no cron)
$ docker run --rm <source env + BACKUP_* env> loki-backup:local backup.sh
[20261020T160608Z] pg_dump
[20261020T160608Z] upload dump
[20261020T160608Z] sync media
INFO  : There was nothing to transfer
[20261020T160608Z] retention: delete dumps older than 30d
[20261020T160608Z] done

## what landed in the backup bucket, raw (names are encrypted)
$ rclone lsf m:loki-backup --max-depth 1
eojfu1u502jc3r09378krmcn68/
gvg775a4t8o7nbg4k4qlsnr2pg/
$ rclone size m:loki-backup
Total objects: 108
Total size: 530.318 KiB (543046 Byte)

## same bucket through the crypt remote
$ docker run --rm <env> --entrypoint sh loki-backup:local -c '. /usr/local/bin/lib.sh; rclone lsf VAULT: ; rclone lsf VAULT:db/'
db/
media/
loki-20261020T160320Z.dump
loki-20261020T160430Z.dump
loki-20261020T160528Z.dump
loki-20261020T160608Z.dump
(104 media objects + 4 dumps = 108 raw objects)

## fresh restore stack
$ docker compose -p loki-restore -f restore-compose.yml up -d      # postgres:17-alpine + minio, no published ports
$ rclone mkdir R:loki                                                  # media bucket in the restore MinIO
$ docker exec loki-restore-db-1 psql -U loki -d loki -Atc '\dt'
Did not find any relations.

## restore
$ docker run --rm --network loki-restore_default <restore env + BACKUP_* env> loki-backup:local restore.sh
restoring database from loki-20261020T160608Z.dump
restoring media into loki
INFO  :   416.725 KiB / 416.725 KiB, 100%, 0 B/s, ETA -
restore done

## verify: row counts (source, then restored)
media|0   sessions|1   tags|1   users|1
media|0   sessions|1   tags|1   users|1

## verify: one restored object byte for byte (sha256 + size, source then restored)
0c1322057801e6857416dd149cda84ba79fa9bb7950a66e439020a33ec4e58f0  -
7876
0c1322057801e6857416dd149cda84ba79fa9bb7950a66e439020a33ec4e58f0  -
7876
        (object memes/u1/00e28e24-e91b-41cc-9aba-b235513e08cf.png)

## verify: all table data, sorted INSERT statements of pg_dump -a (source, then restored)
6cc5770018690d5361626164f3d909b2406087f0886d1efcd814cd01cc1476e3  -
6cc5770018690d5361626164f3d909b2406087f0886d1efcd814cd01cc1476e3  -

## verify: whole bucket, sorted "path;size" listing checksum (source, then restored)
b2ebdadd78d1a848f299cb1404ffd99b1b3b2770139b5b6412e49053cd7fd0fa  -
b2ebdadd78d1a848f299cb1404ffd99b1b3b2770139b5b6412e49053cd7fd0fa  -

## teardown
$ docker compose -p loki-restore -f restore-compose.yml down -v
Container loki-restore-db-1 Removed / Container loki-restore-minio-1 Removed / Network loki-restore_default Removed
$ docker image rm loki-backup:local
$ rclone purge m:loki-backup
```

Notes from the drill: a first checksum comparison without sorting the rows differed only in row order (pg_dump emits physical order), hence the sorted comparison. The drill did not exercise a full-app login against the restored stack (the dev database contains no meme rows); the byte-identical object and identical row checksums are the evidence.
