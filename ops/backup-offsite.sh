#!/usr/bin/env bash
set -euo pipefail

BACKUP_ENV_FILE=${YOPPI_BACKUP_ENV_FILE:-.env.backup}
LOCAL_RETENTION_DAYS=${YOPPI_LOCAL_RETENTION_DAYS:-7}

if [[ ! -f "$BACKUP_ENV_FILE" ]]; then
  echo "missing off-site backup environment: $BACKUP_ENV_FILE" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

echo "Creating local PostgreSQL dump"
backup_output=$(./ops/backup-db.sh)
printf '%s\n' "$backup_output"

latest_backup=$(
  printf '%s\n' "$backup_output" |
    sed -n 's/^Backup complete: //p' |
    tail -n 1
)

if [[ -z "$latest_backup" || ! -f "$latest_backup" ]]; then
  echo "unable to determine newly created PostgreSQL backup" >&2
  exit 1
fi

echo "Uploading encrypted backup to off-site repository"
restic backup \
  "$latest_backup" \
  --tag yoppi-postgres

echo "Applying off-site retention policy"
restic forget \
  --tag yoppi-postgres \
  --group-by host,tags \
  --keep-daily 14 \
  --keep-weekly 8 \
  --keep-monthly 6 \
  --prune

echo "Checking repository integrity"
restic check

echo "Removing local dumps older than ${LOCAL_RETENTION_DAYS} days"
find backups \
  -maxdepth 1 \
  -type f \
  -name 'yoppi-*.dump' \
  -mtime "+${LOCAL_RETENTION_DAYS}" \
  -delete

echo "Off-site PostgreSQL backup complete"
