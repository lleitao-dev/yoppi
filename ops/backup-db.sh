#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=.env.production
BACKUP_DIR=${YOPPI_BACKUP_DIR:-backups}
POSTGRES_TOOL_IMAGE=${YOPPI_POSTGRES_TOOL_IMAGE:-postgres:18-alpine}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing deployment environment: $ENV_FILE" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/yoppi-$STAMP.dump"
TMP="$OUT.tmp"

cleanup() {
  rm -f "$TMP"
}
trap cleanup EXIT

echo "Creating PostgreSQL backup: $OUT"
docker run --rm \
  --env-file "$ENV_FILE" \
  "$POSTGRES_TOOL_IMAGE" \
  sh -c ': "${DATABASE_URL:?DATABASE_URL is required}"; pg_dump --format=custom --compress=9 --no-owner --no-acl "$DATABASE_URL"' \
  > "$TMP"

chmod 600 "$TMP"
mv "$TMP" "$OUT"
trap - EXIT

echo "Backup complete: $OUT"
