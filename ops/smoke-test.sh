#!/usr/bin/env sh
set -eu

BASE_URL=${1:-${YOPPI_BASE_URL:-}}
if [ -z "$BASE_URL" ]; then
  echo "usage: $0 https://yoppi.example.com" >&2
  exit 2
fi

BASE_URL=${BASE_URL%/}

curl --fail --silent --show-error "$BASE_URL/api/v1/health" >/dev/null
curl --fail --silent --show-error "$BASE_URL/api/v1/ready" >/dev/null
curl --fail --silent --show-error "$BASE_URL/" >/dev/null

echo "Yoppi smoke test passed: $BASE_URL"
