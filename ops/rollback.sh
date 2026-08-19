#!/usr/bin/env bash
set -euo pipefail

PREVIOUS_FILE=.yoppi-previous-release
VERSION=${1:-}

if [[ -z "$VERSION" ]]; then
  if [[ ! -f "$PREVIOUS_FILE" ]]; then
    echo "no previous release recorded; provide a version explicitly" >&2
    exit 2
  fi
  VERSION=$(cat "$PREVIOUS_FILE")
fi

echo "Rolling Yoppi back to application image $VERSION"
echo "Database changes are not reversed by this command."
exec ./ops/deploy.sh "$VERSION"
