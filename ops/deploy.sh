#!/usr/bin/env bash
set -euo pipefail

VERSION=${1:-}
MODE=${2:-}
ENV_FILE=.env.production
MIGRATION_ENV_FILE=.env.migration
COMPOSE_FILE=docker-compose.deploy.yml

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <immutable-image-version> [--skip-migrations]" >&2
  exit 2
fi

if [[ -n "$MODE" && "$MODE" != "--skip-migrations" ]]; then
  echo "invalid deployment mode: $MODE" >&2
  echo "usage: $0 <immutable-image-version> [--skip-migrations]" >&2
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

if [[ "$MODE" != "--skip-migrations" && ! -f "$MIGRATION_ENV_FILE" ]]; then
  echo "missing migration environment: $MIGRATION_ENV_FILE" >&2
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

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

container_state() {
  local service=$1
  local container_id

  container_id=$(compose ps -q "$service" 2>/dev/null | head -n 1 || true)
  if [[ -z "$container_id" ]]; then
    printf '%s' "missing"
    return
  fi

  docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$container_id" \
    2>/dev/null \
    || printf '%s' "unknown"
}

wait_for_local_health() {
  local attempt
  local server_state
  local web_state
  local caddy_state

  for attempt in $(seq 1 36); do
    server_state=$(container_state server)
    web_state=$(container_state web)
    caddy_state=$(container_state caddy)

    if [[ "$server_state" == "healthy" \
      && "$web_state" == "healthy" \
      && "$caddy_state" == "running" ]]; then
      return 0
    fi

    sleep 5
  done

  return 1
}

wait_for_public_health() {
  local attempt

  for attempt in $(seq 1 36); do
    if ./ops/smoke-test.sh "https://$YOPPI_DOMAIN" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  return 1
}

print_diagnostics() {
  compose ps >&2 || true
  compose logs --tail=200 >&2 || true
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
compose pull server web caddy

if [[ "$MODE" == "--skip-migrations" ]]; then
  echo "Skipping database migrations"
else
  echo "Applying database migrations with the dedicated migration credential"
  compose --profile migration run --rm --no-deps migrate
fi

echo "Starting Yoppi $YOPPI_VERSION"
compose up -d --remove-orphans

if ! wait_for_local_health; then
  echo "Application containers did not become healthy." >&2
  print_diagnostics

  if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$VERSION" ]]; then
    echo "Attempting automatic application rollback to $CURRENT_VERSION" >&2
    export YOPPI_VERSION="$CURRENT_VERSION"

    compose pull server web caddy || true
    compose up -d --remove-orphans || true

    if wait_for_local_health; then
      echo "Rollback application containers are healthy: $CURRENT_VERSION" >&2

      if wait_for_public_health; then
        echo "Rollback public smoke test passed: $CURRENT_VERSION" >&2
      else
        echo "Rollback application is healthy, but public HTTPS validation failed." >&2
      fi

      exit 1
    fi

    echo "Automatic rollback also failed; manual intervention required." >&2
    print_diagnostics
  fi

  exit 1
fi

echo "Application containers are healthy: $VERSION"

# Local application health establishes which application release is actually
# running. Public DNS/TLS validation is a separate deployment gate.
if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$VERSION" ]]; then
  printf '%s\n' "$CURRENT_VERSION" > "$PREVIOUS_FILE"
fi

printf '%s\n' "$VERSION" > "$CURRENT_FILE"

if ! wait_for_public_health; then
  echo "Application deployment is locally healthy, but public HTTPS validation failed." >&2
  echo "The running application release is recorded as $VERSION; no automatic rollback was attempted." >&2
  echo "Check DNS, TLS/ACME, firewall, and reverse-proxy routing." >&2
  print_diagnostics
  exit 1
fi

echo "Deployment succeeded: $VERSION"
