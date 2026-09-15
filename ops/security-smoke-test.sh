#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 https://host"
  exit 2
fi

BASE_URL="${BASE_URL%/}"

if [[ "$BASE_URL" != https://* ]]; then
  echo "ERROR: security smoke test requires an HTTPS base URL"
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
RATE_COOKIE="$TMP_DIR/rate.cookies"
PAYLOAD_COOKIE="$TMP_DIR/payload.cookies"

cleanup_session() {
  local jar="$1"

  if [[ -s "$jar" ]]; then
    curl -sS \
      --connect-timeout 5 \
      --max-time 10 \
      -b "$jar" \
      -X DELETE \
      "$BASE_URL/api/v1/session" \
      -o /dev/null || true
  fi
}

cleanup() {
  cleanup_session "$RATE_COOKIE"
  cleanup_session "$PAYLOAD_COOKIE"
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

echo '=== sensitive paths ==='

for path in \
  '/.env' \
  '/.env.production' \
  '/.git/config' \
  '/package.json' \
  '/pnpm-lock.yaml' \
  '/docker-compose.deploy.yml' \
  '/apps/server/prisma/schema.prisma' \
  '/ops/deploy.sh'
do
  code="$(curl -sS \
    --connect-timeout 5 \
    --max-time 10 \
    -o /dev/null \
    -w '%{http_code}' \
    "$BASE_URL$path")"

  printf '%-40s %s\n' "$path" "$code"

  [[ "$code" == "404" ]] || fail "$path returned HTTP $code"
done

pass 'sensitive paths are not exposed'

echo
echo '=== security headers ==='

HEADER_FILE="$TMP_DIR/security.headers"

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -D "$HEADER_FILE" \
  -o /dev/null \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/health")"

[[ "$code" == "200" ]] || fail "health endpoint returned HTTP $code"

for expected in \
  'strict-transport-security: max-age=31536000; includeSubDomains' \
  'x-content-type-options: nosniff' \
  'x-frame-options: DENY' \
  'referrer-policy: no-referrer' \
  'cross-origin-opener-policy: same-origin' \
  'cross-origin-resource-policy: same-site'
do
  grep -Fqi "$expected" "$HEADER_FILE" ||
    fail "missing security header: $expected"
done

grep -Fqi 'permissions-policy:' "$HEADER_FILE" ||
  fail 'missing permissions-policy header'

pass 'production security headers are present'

echo
echo '=== HTTP CORS ==='

CORS_HEADERS="$TMP_DIR/cors.headers"

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -X OPTIONS \
  -H 'Origin: https://attacker.example' \
  -H 'Access-Control-Request-Method: POST' \
  -D "$CORS_HEADERS" \
  -o /dev/null \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$code" == "204" ]] || fail "foreign preflight returned HTTP $code"

if grep -Fqi 'access-control-allow-origin: https://attacker.example' "$CORS_HEADERS"; then
  fail 'foreign origin was reflected by CORS'
fi

pass 'foreign HTTP origin is not authorized'

echo
echo '=== HTTP malformed input ==='

BODY="$TMP_DIR/body"

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -H 'Content-Type: application/json' \
  --data-binary '{"displayName":' \
  -o "$BODY" \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$code" == "400" ]] || fail "malformed JSON returned HTTP $code"
grep -Fq '"code":"REQUEST_ERROR"' "$BODY" ||
  fail 'malformed JSON did not return REQUEST_ERROR'

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -H 'Content-Type: application/json' \
  --data-binary '{"displayName":"x"}' \
  -o "$BODY" \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$code" == "400" ]] || fail "invalid display name returned HTTP $code"
grep -Fq '"code":"VALIDATION_ERROR"' "$BODY" ||
  fail 'invalid display name did not return VALIDATION_ERROR'

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -H 'Content-Type: application/json' \
  --data-binary '{"gameType":"blackjack"}' \
  -o "$BODY" \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/rooms")"

[[ "$code" == "401" ]] || fail "unauthenticated room creation returned HTTP $code"
grep -Fq '"code":"UNAUTHENTICATED"' "$BODY" ||
  fail 'unauthenticated room creation did not return UNAUTHENTICATED'

pass 'malformed and unauthenticated HTTP input is rejected safely'

echo
echo '=== HTTP body limit ==='

python3 - <<'PY' > "$TMP_DIR/large.json"
import json
print(json.dumps({"displayName": "A" * 40000}))
PY

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -H 'Content-Type: application/json' \
  --data-binary @"$TMP_DIR/large.json" \
  -o "$BODY" \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$code" == "413" ]] || fail "oversized HTTP body returned HTTP $code"

pass 'HTTP 32 KiB body limit is enforced'

echo
echo '=== Socket.IO origin policy ==='

SOCKET_URL="$BASE_URL/socket.io/?EIO=4&transport=polling"

allowed_code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -H "Origin: $BASE_URL" \
  -o "$TMP_DIR/socket.allowed" \
  -w '%{http_code}' \
  "$SOCKET_URL")"

[[ "$allowed_code" == "200" ]] ||
  fail "configured Socket.IO origin returned HTTP $allowed_code"

grep -Fq '"maxPayload":32768' "$TMP_DIR/socket.allowed" ||
  fail 'Socket.IO handshake did not advertise 32768 maxPayload'

rejected_code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -H 'Origin: https://attacker.example' \
  -o "$TMP_DIR/socket.rejected" \
  -w '%{http_code}' \
  "$SOCKET_URL")"

[[ "$rejected_code" == "403" ]] ||
  fail "foreign Socket.IO origin returned HTTP $rejected_code"

grep -Fq '"message":"Forbidden"' "$TMP_DIR/socket.rejected" ||
  fail 'foreign Socket.IO origin did not return Forbidden'

originless_code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -o /dev/null \
  -w '%{http_code}' \
  "$SOCKET_URL")"

[[ "$originless_code" == "200" ]] ||
  fail "same-host origin-less Socket.IO handshake returned HTTP $originless_code"

pass 'Socket.IO origin policy is enforced'

echo
echo '=== unauthenticated realtime connection ==='

BASE="$BASE_URL" \
pnpm --filter @yoppi/web exec node --input-type=module - <<'NODE'
import { io } from 'socket.io-client';

const base = process.env.BASE;

const socket = io(base, {
  path: '/socket.io/',
  transports: ['polling'],
  reconnection: false,
  timeout: 5000,
  extraHeaders: {
    Origin: base,
  },
});

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('Timed out waiting for authentication rejection')),
    7000,
  );

  socket.once('connect', () => {
    clearTimeout(timer);
    reject(new Error('Unauthenticated socket connected'));
  });

  socket.once('connect_error', (error) => {
    clearTimeout(timer);
    resolve(error);
  });
});

if (result.message !== 'UNAUTHENTICATED') {
  throw new Error(`Unexpected authentication result: ${result.message}`);
}

console.log('PASS: unauthenticated realtime connection rejected');
socket.disconnect();
NODE

echo
echo '=== realtime validation and rate limiting ==='

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -c "$RATE_COOKIE" \
  -H 'Content-Type: application/json' \
  --data-binary '{"displayName":"SecurityProbe"}' \
  -o "$BODY" \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$code" == "201" ]] || fail "could not create realtime rate-limit probe: HTTP $code"

COOKIE_JAR="$RATE_COOKIE" BASE="$BASE_URL" \
pnpm --filter @yoppi/web exec node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { io } from 'socket.io-client';

function readCookies(path) {
  const cookies = [];

  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!raw || (raw.startsWith('#') && !raw.startsWith('#HttpOnly_'))) continue;

    const fields = raw.split('\t');
    if (fields.length >= 7 && fields[5] && fields[6]) {
      cookies.push(`${fields[5]}=${fields[6]}`);
    }
  }

  if (cookies.length === 0) throw new Error('No session cookie found');
  return cookies.join('; ');
}

const base = process.env.BASE;
const cookie = readCookies(process.env.COOKIE_JAR);

const socket = io(base, {
  path: '/socket.io/',
  transports: ['polling'],
  reconnection: false,
  timeout: 5000,
  extraHeaders: {
    Origin: base,
    Cookie: cookie,
  },
});

let validationErrors = 0;
let rateLimitErrors = 0;

let resolveRateLimit;
let rejectRateLimit;

const rateLimitPromise = new Promise((resolve, reject) => {
  resolveRateLimit = resolve;
  rejectRateLimit = reject;
});

const timeout = setTimeout(() => {
  rejectRateLimit(new Error('Timed out waiting for RATE_LIMITED'));
}, 8000);

socket.on('server:error', (error) => {
  if (error?.code === 'VALIDATION_ERROR') validationErrors += 1;

  if (error?.code === 'RATE_LIMITED') {
    rateLimitErrors += 1;
    resolveRateLimit(error);
  }
});

await new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('connect_error', reject);
});

socket.emit('room:subscribe', {});

const validationDeadline = Date.now() + 3000;

while (validationErrors === 0 && Date.now() < validationDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

if (validationErrors === 0) {
  throw new Error('Malformed room:subscribe did not produce VALIDATION_ERROR');
}

for (let i = 0; i < 130; i += 1) {
  socket.emit('room:subscribe', {});
}

const rateError = await rateLimitPromise;
clearTimeout(timeout);

if (rateError.code !== 'RATE_LIMITED') {
  throw new Error(`Unexpected limiter error: ${rateError.code}`);
}

console.log(`validation errors observed: ${validationErrors}`);
console.log(`rate-limit errors observed: ${rateLimitErrors}`);
console.log('PASS: malformed realtime input rejected safely');
console.log('PASS: realtime rate limit enforced');

socket.disconnect();
NODE

delete_code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -b "$RATE_COOKIE" \
  -X DELETE \
  -o /dev/null \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$delete_code" == "204" ]] ||
  fail "rate-limit probe cleanup returned HTTP $delete_code"

rm -f "$RATE_COOKIE"

echo
echo '=== realtime payload limit ==='

code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -c "$PAYLOAD_COOKIE" \
  -H 'Content-Type: application/json' \
  --data-binary '{"displayName":"PayloadProbe"}' \
  -o /dev/null \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$code" == "201" ]] ||
  fail "could not create realtime payload probe: HTTP $code"

COOKIE_JAR="$PAYLOAD_COOKIE" BASE="$BASE_URL" \
pnpm --filter @yoppi/web exec node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { io } from 'socket.io-client';

function readCookies(path) {
  const cookies = [];

  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!raw || (raw.startsWith('#') && !raw.startsWith('#HttpOnly_'))) continue;

    const fields = raw.split('\t');
    if (fields.length >= 7 && fields[5] && fields[6]) {
      cookies.push(`${fields[5]}=${fields[6]}`);
    }
  }

  if (cookies.length === 0) throw new Error('No session cookie found');
  return cookies.join('; ');
}

const base = process.env.BASE;
const cookie = readCookies(process.env.COOKIE_JAR);

const socket = io(base, {
  path: '/socket.io/',
  transports: ['polling'],
  reconnection: false,
  timeout: 5000,
  extraHeaders: {
    Origin: base,
    Cookie: cookie,
  },
});

await new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('connect_error', reject);
});

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('Oversized realtime payload was not rejected')),
    7000,
  );

  socket.once('disconnect', (reason) => {
    clearTimeout(timer);
    resolve({ type: 'disconnect', reason });
  });

  socket.io.engine.once('error', (error) => {
    clearTimeout(timer);
    resolve({
      type: 'engine-error',
      reason: error?.message ?? String(error),
    });
  });

  socket.emit('room:subscribe', {
    roomId: 'A'.repeat(40000),
  });
});

console.log(`oversized payload result: ${result.type}`);
console.log(`reason: ${result.reason}`);
console.log('PASS: oversized realtime payload rejected');

socket.disconnect();
NODE

delete_code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -b "$PAYLOAD_COOKIE" \
  -X DELETE \
  -o /dev/null \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$delete_code" == "204" ]] ||
  fail "payload probe cleanup returned HTTP $delete_code"

rm -f "$PAYLOAD_COOKIE"

echo
echo '=== forwarded-address spoof resistance ==='

NORMAL_HEADERS="$TMP_DIR/normal.headers"
SPOOF_HEADERS="$TMP_DIR/spoof.headers"

normal_code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -D "$NORMAL_HEADERS" \
  -o /dev/null \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

spoof_code="$(curl -sS \
  --connect-timeout 5 \
  --max-time 10 \
  -H 'X-Forwarded-For: 203.0.113.77' \
  -D "$SPOOF_HEADERS" \
  -o /dev/null \
  -w '%{http_code}' \
  "$BASE_URL/api/v1/session")"

[[ "$normal_code" == "401" ]] ||
  fail "normal unauthenticated request returned HTTP $normal_code"

[[ "$spoof_code" == "401" ]] ||
  fail "spoofed forwarding request returned HTTP $spoof_code"

normal_remaining="$(
  awk -F': ' 'tolower($1) == "x-ratelimit-remaining" {
    gsub("\r", "", $2)
    print $2
  }' "$NORMAL_HEADERS" | tail -1
)"

spoof_remaining="$(
  awk -F': ' 'tolower($1) == "x-ratelimit-remaining" {
    gsub("\r", "", $2)
    print $2
  }' "$SPOOF_HEADERS" | tail -1
)"

[[ "$normal_remaining" =~ ^[0-9]+$ ]] ||
  fail 'normal rate-limit remaining header missing'

[[ "$spoof_remaining" =~ ^[0-9]+$ ]] ||
  fail 'spoofed rate-limit remaining header missing'

(( spoof_remaining < normal_remaining )) ||
  fail 'X-Forwarded-For appears to reset the rate-limit bucket'

pass 'client-supplied X-Forwarded-For does not bypass rate limiting'

echo
echo '=== post-probe application health ==='

./ops/smoke-test.sh "$BASE_URL"

echo
echo '=== HTTP rate limiting ==='

BASE="$BASE_URL" python3 - <<'PY'
import os
import urllib.error
import urllib.request

url = os.environ["BASE"] + "/api/v1/session"

first_429 = None
last_limit = None
last_remaining = None
last_retry_after = None

for i in range(1, 260):
    req = urllib.request.Request(url)

    try:
        response = urllib.request.urlopen(req, timeout=10)
        status = response.status
        headers = response.headers
        response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        headers = exc.headers
        exc.read()

    last_limit = headers.get("x-ratelimit-limit")
    last_remaining = headers.get("x-ratelimit-remaining")
    last_retry_after = headers.get("retry-after")

    if status == 429:
        first_429 = i
        break

print("configured limit:", last_limit)
print("first 429 request:", first_429)
print("remaining:", last_remaining)
print("retry-after:", last_retry_after)

if last_limit != "240":
    raise SystemExit("FAIL: unexpected HTTP rate-limit value")

if first_429 is None:
    raise SystemExit("FAIL: HTTP limiter did not return 429")

if first_429 > 241:
    raise SystemExit("FAIL: HTTP limiter allowed too many requests")

if not last_retry_after:
    raise SystemExit("FAIL: HTTP limiter omitted Retry-After")

print("PASS: public HTTP rate limiting enforced")
PY

echo
echo "Yoppi security smoke test passed: $BASE_URL"
