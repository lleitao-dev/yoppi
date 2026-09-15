#!/usr/bin/env sh
set -eu

BASE_URL=${1:-${YOPPI_BASE_URL:-}}
if [ -z "$BASE_URL" ]; then
  echo "usage: $0 https://yoppi.example.com" >&2
  exit 2
fi

BASE_URL=${BASE_URL%/}

check_url() {
  curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time 10 \
    "$1" \
    >/dev/null
}

check_url "$BASE_URL/api/v1/health"
check_url "$BASE_URL/api/v1/ready"
check_url "$BASE_URL/"

echo "Yoppi smoke test passed: $BASE_URL"
