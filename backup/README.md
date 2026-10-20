# Backups and restore runbook

What the `backup` service (`compose.prod.yml`, commented out by default) saves, by default every night at 03:00:

| What                              | How                                          | Where (in the backup bucket, through the rclone crypt remote `VAULT:`)                                                   |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Postgres                          | `pg_dump -Fc` to `loki-<UTC timestamp>.dump` | `VAULT:db/` (copied, never synced; dumps older than `BACKUP_RETENTION_DAYS`, default 30, are deleted)                    |
| Media bucket                      | `rclone sync` of `S3_BUCKET`                 | `VAULT:media/` (a mirror of the bucket)                                                                                  |
| Media that disappeared or changed | moved aside by the sync (`--backup-dir`)     | `VAULT:media-deleted/<UTC timestamp of the run>/<original path>` (folders older than `BACKUP_RETENTION_DAYS` are purged) |

Everything in the backup bucket, file names included, is encrypted client-side with rclone crypt (`BACKUP_CRYPT_PASSWORD`, `BACKUP_CRYPT_SALT`). **Keep both values outside the server: without them the backups are unreadable.**

Files: `Dockerfile` (alpine, `postgresql17-client`, `rclone`, healthcheck), `backup.sh`, `restore.sh`, `lib.sh` (rclone remote setup), `entrypoint.sh` (installs the crontab from `BACKUP_CRON`, runs `crond`). Configuration lives in `backup.env` (template `backup.env.example`), see `docs/deployment.md` for every variable and why it is separate from `.env`.

## Protecting the backups themselves

- **Separate credentials.** The backup bucket gets its own token, scoped to that bucket. The app's media token must not reach it, and `backup.env` is not read by the `app` container. The media token inside `backup.env` should be read-only.
- **`media-deleted/` recovery folder.** The mirror is a sync, so a deletion in the app would otherwise be a deletion in the backup. Deleted and overwritten objects are therefore moved to `VAULT:media-deleted/<run stamp>/` and kept for `BACKUP_RETENTION_DAYS`. To recover an accidentally deleted file: `rclone lsf -R VAULT:media-deleted/` to find it, `rclone copyto VAULT:media-deleted/<stamp>/<path> MEDIA:$S3_BUCKET/<path>`.
- **Mass-delete guard.** A run that would remove more than `BACKUP_MAX_DELETE` (default 200) objects from the mirror aborts with a non-zero exit and leaves the mirror untouched; the healthcheck then goes unhealthy once `BACKUP_MAX_AGE_HOURS` pass without a success. Investigate, then re-run with a higher limit (`-e BACKUP_MAX_DELETE=...`) if the deletion was intended.
- **What the provider can add (not enforced by this repo).** The strongest protection against a compromised host or token is that the backup token cannot delete. Cloudflare R2 supports neither object versioning nor object lock, and its API tokens only distinguish read/write/admin scopes (write includes delete), so on R2 `media-deleted/`, the max-delete guard and token separation are the available defences. With a provider that has them (AWS S3, Backblaze B2, Wasabi, MinIO), enable **object versioning and/or object lock** on the backup bucket and give the backup credentials **no delete permission** (`s3:PutObject`, `s3:ListBucket`, `s3:GetObject` only); then lifecycle rules, not the job, expire old objects, and `BACKUP_RETENTION_DAYS` pruning will report permission errors that can be ignored. An occasional offline copy of a dump is a good addition either way.

## Operations (production)

```sh
cp backup.env.example backup.env && chmod 600 backup.env   # fill in
# uncomment `backup:` in compose.prod.yml, then
docker compose -f compose.prod.yml up -d --build backup
docker compose -f compose.prod.yml logs backup             # "backup: schedule '0 3 * * *' (UTC), ..."
docker compose -f compose.prod.yml exec backup backup.sh   # one backup right now
```

**Failure visibility.** A successful run touches `/var/run/backup.ok`; the container is `unhealthy` when that file is older than `BACKUP_MAX_AGE_HOURS` (default 48, i.e. two daily intervals; set it to 2x your `BACKUP_CRON` interval). Check with `docker compose -f compose.prod.yml ps backup` (or alert on the health state) and, at least weekly, look at the newest dump:

```sh
docker compose -f compose.prod.yml exec backup sh -c '. /usr/local/bin/lib.sh; rclone lsf VAULT:db/ | sort | tail -n 1'
```

The file name contains the UTC timestamp of the dump; it must be younger than a day or two.

## Restore

Prerequisites: a target stack with an **empty** Postgres (database `loki` exists, no tables) and an existing, empty media bucket; the backup bucket credentials and crypt keys.

`restore.sh` refuses to run unless `RESTORE_CONFIRM=yes`, and refuses when the target database already has tables unless `RESTORE_FORCE=1` (then `pg_restore --clean --if-exists` overwrites them; the media `rclone sync` always makes the target bucket equal to the backup). `RESTORE_DUMP=<file>` selects a dump; the default is the newest.

1. Bring up the target stack's `db` (and `minio` if self-hosted); do not start `app` yet. Create the media bucket.
2. Put the **target's** connection data in `restore.env` (not committed; it overrides the `S3_*` of `backup.env`, which describe the old source):

   ```text
   DATABASE_URL=postgres://loki:<POSTGRES_PASSWORD>@db:5432/loki
   S3_ENDPOINT=...   S3_BUCKET=...   S3_ACCESS_KEY_ID=...   S3_SECRET_ACCESS_KEY=...   (one per line)
   ```

3. Run the restore. Later `--env-file`s win, so `backup.env` supplies the `BACKUP_*` keys and `restore.env` the target:

   ```sh
   docker build -t loki-backup:local ./backup
   docker run --rm --network <target compose network> \
     --env-file backup.env --env-file restore.env -e RESTORE_CONFIRM=yes \
     loki-backup:local restore.sh
   ```

4. Start `app`, log in, open a meme.

Manual equivalent (single dump, selective restore): `rclone lsf VAULT:db/`, `rclone copy VAULT:db/<file> /tmp/`, `pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" /tmp/<file>`, `rclone sync VAULT:media/ MEDIA:$S3_BUCKET` (remotes as defined in `lib.sh`).

## Drill transcripts (executed against the dev stack, 2026-10-20)

Source: the dev compose project `loki-dev` (Postgres `loki`, MinIO bucket `loki` with 104 objects, 416.7 KiB, left by earlier development runs, so no seeding was needed). The dev `media` table is empty (the bucket objects are orphans), so the database check uses the other tables plus a checksum over all rows; no meme could be opened in the app. Stand-in backup bucket: `loki-backup` on the same dev MinIO, throwaway crypt keys. Restore target: a fresh compose project `loki-restore` (own Postgres 17 and MinIO). Everything ran on a remote Docker host (`DOCKER_HOST=ssh://dev-host`); the environment came from `--env-file backup.env` / `restore.env` as described above. Output is from one script run (`INFO ... Copied (new)` lines for the 104 media objects and rclone's `Config file ... not found` notices are omitted, `m:`/`R:` are admin rclone remotes for the dev and restore MinIO).

### Backup (first run into an empty backup bucket)

```text
$ rclone size m:loki
Total objects: 104
Total size: 416.725 KiB (426726 Byte)

$ docker run --rm --env-file backup.env loki-backup:local backup.sh
[20261020T161239Z] pg_dump
[20261020T161239Z] upload dump
[20261020T161239Z] sync media
INFO  :   421.600 KiB / 421.600 KiB, 100%, 366.256 KiB/s, ETA 0s
[20261020T161239Z] retention: delete dumps and media-deleted folders older than 30d
[20261020T161239Z] done

$ rclone lsf m:loki-backup --max-depth 1          # raw: names are encrypted
eojfu1u502jc3r09378krmcn68/
gvg775a4t8o7nbg4k4qlsnr2pg/
$ rclone size m:loki-backup
Total objects: 105
Total size: 448.779 KiB (459550 Byte)

$ rclone lsf VAULT: ; rclone lsf VAULT:db/ ; rclone size VAULT:media/      # decrypted view
db/
media/
loki-20261020T161239Z.dump
Total objects: 104
Total size: 416.725 KiB (426726 Byte)
```

The size figures reconcile: the 104 media objects grow from 416.725 to 421.600 KiB by rclone crypt's per-file overhead (104 x 48 bytes = 4.875 KiB), and the bucket holds those plus one dump (27.2 KiB) = 105 objects, 448.779 KiB.

### Deleted objects are kept in `media-deleted/` (scratch objects `drill-scratch/one.txt`, `two.txt` created in the source bucket for this test and removed again)

```text
$ rclone deletefile m:loki/drill-scratch/one.txt        # simulated delete in the app
$ docker run --rm --env-file backup.env loki-backup:local backup.sh
[20261020T161259Z] sync media
INFO  : drill-scratch/one.txt: Copied (server-side copy)
INFO  : drill-scratch/one.txt: Deleted
INFO  : drill-scratch/one.txt: Moved into backup dir
...
$ rclone lsf VAULT:media/drill-scratch/
two.txt
$ rclone lsf -R VAULT:media-deleted/
20261020T161259Z/drill-scratch/one.txt
20261020T161259Z/
20261020T161259Z/drill-scratch/
$ rclone cat VAULT:media-deleted/20261020T161259Z/drill-scratch/one.txt
scratch one

# mass-delete guard: delete two.txt, run with BACKUP_MAX_DELETE=0
[20261020T161304Z] sync media
ERROR : drill-scratch/two.txt: Got fatal error on delete: --max-delete threshold reached
ERROR : Cancelling sync due to fatal error: failed to delete 1 files
NOTICE: Failed to sync with 2 errors: last error was: failed to delete 1 files
$ rclone lsf VAULT:media/drill-scratch/                  # mirror untouched
two.txt
```

Retention of `media-deleted/` was tested separately in an earlier run of the same script with `BACKUP_RETENTION_DAYS=0`: the older stamped folder was purged, the folder of the current run was kept.

### Scheduled path (cron to entrypoint to backup.sh, with the persisted environment)

```text
$ docker run -d --name loki-backup-crontest --env-file backup.env -e BACKUP_CRON='* * * * *' -e BACKUP_MAX_AGE_HOURS=1 loki-backup:local
$ sleep 80; docker logs loki-backup-crontest
backup: schedule '* * * * *' (UTC), retention 30 days
[20261020T161400Z] pg_dump
[20261020T161400Z] upload dump
[20261020T161400Z] sync media
INFO  : There was nothing to transfer
[20261020T161400Z] retention: delete dumps and media-deleted folders older than 30d
[20261020T161400Z] done
$ docker inspect -f '{{.State.Health.Status}}' loki-backup-crontest
healthy
$ docker exec loki-backup-crontest ls -l /etc/backup.env /var/run/backup.ok
-rw-------    1 root     root           727 Oct 20 16:13 /etc/backup.env
-rw-------    1 root     root             0 Oct 20 16:14 /var/run/backup.ok
$ docker rm -f loki-backup-crontest
```

### Restore into a fresh stack

```text
$ docker compose -p loki-restore -f restore-compose.yml up -d     # postgres:17-alpine + minio, no published ports
$ rclone mkdir R:loki                                              # empty media bucket in the restore MinIO

$ docker run --rm --network loki-restore_default --env-file backup.env --env-file restore.env loki-backup:local restore.sh
refusing: set RESTORE_CONFIRM=yes to restore into db:5432/loki and bucket loki

$ ... -e RESTORE_CONFIRM=yes loki-backup:local restore.sh
restoring database from loki-20261020T161400Z.dump
restoring media into loki
INFO  :   416.725 KiB / 416.725 KiB, 100%, 64.249 KiB/s, ETA 0s
restore done

$ ... -e RESTORE_CONFIRM=yes loki-backup:local restore.sh          # again, now into a non-empty database
refusing: target database already has 12 tables (set RESTORE_FORCE=1 to overwrite)

$ ... -e RESTORE_CONFIRM=yes -e RESTORE_FORCE=1 -e BACKUP_CRYPT_PASSWORD=wrong loki-backup:local restore.sh
no dump found in VAULT:db/ (wrong BACKUP_S3_* credentials/bucket, or wrong BACKUP_CRYPT_PASSWORD/SALT, would also look like this)
```

### Verification (source, then restored)

```text
row counts (users, media, tags, sessions)
media|0 sessions|1 tags|1 users|1
media|0 sessions|1 tags|1 users|1

sha256 of every row, pg_dump -a --inserts | grep ^INSERT | sort | sha256sum
6cc5770018690d5361626164f3d909b2406087f0886d1efcd814cd01cc1476e3  -
6cc5770018690d5361626164f3d909b2406087f0886d1efcd814cd01cc1476e3  -

rclone lsf -R --format ps (path;size) | sort | sha256sum   # whole media bucket, 104 objects
b2ebdadd78d1a848f299cb1404ffd99b1b3b2770139b5b6412e49053cd7fd0fa  -
b2ebdadd78d1a848f299cb1404ffd99b1b3b2770139b5b6412e49053cd7fd0fa  -

rclone cat <memes/u1/00e28e24-e91b-41cc-9aba-b235513e08cf.png> | sha256sum
6d94aa4c87d8d43925694f56386ceed501b1f8557bd6fae244dcd7d00191f0a7  -
6d94aa4c87d8d43925694f56386ceed501b1f8557bd6fae244dcd7d00191f0a7  -
```

Notes: the object check in this run went through a `grep` filter in the drill helper, which appended a newline to both sides (hence 7877 instead of 7876 bytes); an earlier unfiltered run of the same check gave the identical sha256 on both sides (`0c13220578...`, 7876 bytes; the source object differed between the two runs, likely rewritten by dev activity). Comparing the data checksum requires sorting, because `pg_dump` emits rows in physical order.

### Teardown

```text
$ docker compose -p loki-restore -f restore-compose.yml down -v      # containers, volumes, network removed
$ rclone purge m:loki-backup ; docker image rm loki-backup:local
```
