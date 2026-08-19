#!/usr/bin/env bash
set -euo pipefail

VERSION=${1:-}
ENV_FILE=.env.production
COMPOSE_FILE=docker-compose.deploy.yml

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <immutable-image-version>" >&2
  exit 2
fi

if [[ ! "$VERSION" =~ ^v[0-9A-Za-z][0-9A-Za-z._-]*$ ]]; then
  echo "invalid release version: $VERSION" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing deployment environment: $ENV_FILE" >&2
  exit 2
fi

read_env_value() {
  local key=$1
  local value
  value=$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)
  value=${value%$'\r'}
  value=${value#\"}
  value=${value%\"}
  value=${value#\'}
  value=${value%\'}
  printf '%s' "$value"
}

YOPPI_DOMAIN=${YOPPI_DOMAIN:-$(read_env_value YOPPI_DOMAIN)}
if [[ -z "$YOPPI_DOMAIN" ]]; then
  echo "YOPPI_DOMAIN must be set in $ENV_FILE" >&2
  exit 2
fi

CURRENT_FILE=.yoppi-release
PREVIOUS_FILE=.yoppi-previous-release
CURRENT_VERSION=""
if [[ -f "$CURRENT_FILE" ]]; then
  CURRENT_VERSION=$(cat "$CURRENT_FILE")
fi

export YOPPI_VERSION="$VERSION"

echo "Pulling Yoppi $YOPPI_VERSION"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull

echo "Starting Yoppi $YOPPI_VERSION"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

for attempt in $(seq 1 36); do
  if ./ops/smoke-test.sh "https://$YOPPI_DOMAIN" >/dev/null 2>&1; then
    if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$VERSION" ]]; then
      printf '%s\n' "$CURRENT_VERSION" > "$PREVIOUS_FILE"
    fi
    printf '%s\n' "$VERSION" > "$CURRENT_FILE"
    echo "Deployment succeeded: $VERSION"
    exit 0
  fi
  sleep 5
done

echo "Deployment did not become healthy." >&2
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps >&2 || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 >&2 || true

if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$VERSION" ]]; then
  echo "Attempting automatic application rollback to $CURRENT_VERSION" >&2
  export YOPPI_VERSION="$CURRENT_VERSION"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull || true
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans || true
  for attempt in $(seq 1 24); do
    if ./ops/smoke-test.sh "https://$YOPPI_DOMAIN" >/dev/null 2>&1; then
      echo "Rollback succeeded: $CURRENT_VERSION" >&2
      exit 1
    fi
    sleep 5
  done
  echo "Automatic rollback also failed; manual intervention required." >&2
fi

exit 1
