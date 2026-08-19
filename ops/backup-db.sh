#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=.env.production
BACKUP_DIR=${YOPPI_BACKUP_DIR:-backups}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing deployment environment: $ENV_FILE" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/yoppi-$STAMP.dump"

echo "Creating PostgreSQL backup: $OUT"
docker run --rm \
  --env-file "$ENV_FILE" \
  postgres:16-alpine \
  sh -c ': "${DATABASE_URL:?DATABASE_URL is required}"; pg_dump --format=custom --compress=9 --no-owner --no-acl "$DATABASE_URL"' \
  > "$OUT"
chmod 600 "$OUT"

echo "Backup complete: $OUT"
