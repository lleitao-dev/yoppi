# Yoppi PostgreSQL Backup and Recovery

Yoppi uses PostgreSQL 18 custom-format logical backups.

## Backup architecture

Backups have three layers:

1. DigitalOcean managed PostgreSQL provider backups.
2. Local dumps under `/opt/yoppi/backups`.
3. Encrypted Restic snapshots stored in private S3-compatible object storage.

The Yoppi application does not need to be running for backups to succeed. The backup process connects directly to managed PostgreSQL.

## Production files

Configuration:

- `/opt/yoppi/.env.production`
- `/opt/yoppi/.env.backup`

Scripts:

- `ops/backup-db.sh`
- `ops/backup-offsite.sh`
- `ops/restore-db.sh`

Systemd:

- `deploy/systemd/yoppi-backup.service`
- `deploy/systemd/yoppi-backup.timer`

## Backup secrets

`.env.backup` contains:

- `RESTIC_REPOSITORY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `RESTIC_PASSWORD`
- `RESTIC_CACHE_DIR`

Never commit `.env.backup`.

The Restic password must also be stored outside the Droplet in the operator password manager. Losing it makes the encrypted repository unrecoverable.

## Manual backup

Local database dump:

    ./ops/backup-db.sh

Encrypted off-site backup:

    ./ops/backup-offsite.sh

## Retention

Local dumps:

- 7 days

Off-site snapshots:

- 14 daily
- 8 weekly
- 6 monthly

Restic retention is grouped by host and tag.

## Scheduled backup

The systemd timer runs approximately daily at 04:30 UTC with up to 15 minutes randomized delay.

`Persistent=true` allows a missed run to execute after the host becomes available again.

On the Droplet:

    systemctl status yoppi-backup.timer --no-pager
    systemctl list-timers --all --no-pager | grep yoppi-backup
    journalctl -u yoppi-backup.service --no-pager

Run a backup through systemd:

    sudo systemctl start yoppi-backup.service
    systemctl status yoppi-backup.service --no-pager

A successful oneshot service normally finishes as `inactive (dead)` with `status=0/SUCCESS`.

## Restic inspection

From `/opt/yoppi` on the Droplet:

    set -a
    source .env.backup
    set +a
    restic snapshots --tag yoppi-postgres

Repository integrity:

    restic check

A healthy repository reports `no errors were found`.

## Restore safety

`ops/restore-db.sh` restores into the database configured by `.env.production` and requires explicit confirmation:

    RESTORE_CONFIRM=restore-yoppi ./ops/restore-db.sh backups/<backup>.dump

Do not use the production restore path for routine recovery testing.

Recovery drills must restore a dump from the off-site Restic repository into an isolated temporary PostgreSQL database.

Validate:

- PostgreSQL archive readability
- expected application tables
- Prisma migration history
- representative row counts
- cleanup of the temporary database

The September 2026 staging recovery drill successfully restored an encrypted off-site snapshot and matched production counts for `GameSession`, `Player`, `Room`, `RoomMember`, and `_prisma_migrations`.

## Restart constraint

Active Yoppi game state is currently held in server memory. Application or host restarts terminate active games even though persistent database records remain in PostgreSQL.
