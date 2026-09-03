#!/usr/bin/env bash
set -euo pipefail

BACKUP=${1:-}
ENV_FILE=.env.production
POSTGRES_TOOL_IMAGE=${YOPPI_POSTGRES_TOOL_IMAGE:-postgres:18-alpine}

if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "usage: RESTORE_CONFIRM=restore-yoppi $0 <backup.dump>" >&2
  exit 2
fi

if [[ ${RESTORE_CONFIRM:-} != "restore-yoppi" ]]; then
  echo "restore refused; set RESTORE_CONFIRM=restore-yoppi explicitly" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing deployment environment: $ENV_FILE" >&2
  exit 2
fi

echo "Restoring $BACKUP into the configured production database"
cat "$BACKUP" | docker run --rm -i \
  --env-file "$ENV_FILE" \
  "$POSTGRES_TOOL_IMAGE" \
  sh -c ': "${DATABASE_URL:?DATABASE_URL is required}"; pg_restore --clean --if-exists --no-owner --no-acl --dbname "$DATABASE_URL"'

echo "Restore complete. Restart Yoppi and run smoke tests."
