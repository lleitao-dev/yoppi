# Yoppi Online Casino — Hardening v0.8.1

Yoppi is a multiplayer, play-money casino project with server-authoritative Blackjack and No-Limit Texas Hold'em. v0.8.1 includes the v0.8.0 stabilization release plus strict TypeScript corrections in Poker and room lifecycle code: game rules are unchanged while the application gains CI, deployment health checks, structured logging, abuse controls, graceful shutdown, and production Docker targets.

## Included in v0.8.1

- GitHub Actions CI for formatting, linting, typechecking, tests, workspace builds, production image builds, and Playwright multiplayer coverage
- non-blocking high-severity dependency audit job to surface dependency risk without hiding build/test results
- structured Fastify/Pino logging with configurable log level and cookie/authorization redaction
- stable JSON 404 and global error responses that avoid leaking internal server errors to clients
- liveness endpoint at `/api/v1/health`
- PostgreSQL-backed readiness endpoint at `/api/v1/ready`
- HTTP fixed-window rate limiting with `429`, `Retry-After`, and rate-limit headers
- Socket.IO action rate limiting per authenticated player
- strict Socket.IO browser-origin enforcement
- request body and Socket.IO payload size limits
- security response headers, with HSTS enabled in production
- configurable trusted-proxy behavior for deployment behind a reverse proxy/load balancer
- bounded graceful shutdown on SIGINT/SIGTERM, including Socket.IO timers and Prisma disconnection
- configurable 15-second minimum-player grace period
- development and production Docker targets using the same Dockerfiles
- non-root production API and web containers
- Compose readiness gating so the web service waits for a ready API

v0.8.1 also corrects strict `noUncheckedIndexedAccess` errors in Poker deck/evaluator/engine code, room lifecycle tests, and room persistence input narrowing. No Prisma migration is required.

## Current product scope

- guest identities using secure HTTP-only sessions
- private rooms with room codes
- reconnect, host transfer, deliberate leave, queued active-game joins, and game-specific admission boundaries
- Blackjack for 1–5 players
- Texas Hold'em for 2–6 players
- play chips only; no deposits, purchases, withdrawals, redemption, or transferable balances

## Development start

Requirements: Docker with Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Web: http://localhost:3000
- Liveness: http://localhost:4000/api/v1/health
- Readiness: http://localhost:4000/api/v1/ready

Expected liveness response:

```json
{"status":"ok"}
```

Expected readiness response after PostgreSQL is available:

```json
{"status":"ready"}
```

## Quality checks

Inside a dependency-installed checkout:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For multiplayer browser coverage, keep Docker Compose running and use:

```bash
pnpm test:e2e
```

GitHub Actions runs the same quality gates on pushes to `main` and on pull requests. The dependency-audit job is currently advisory because the project has not yet completed a dependency-upgrade cycle; audit findings should be reviewed before public deployment.

## Production image build

The ordinary Compose file selects the hot-reload `development` Docker targets. Production images can be built directly:

```bash
docker build --target production -f apps/server/Dockerfile -t yoppi-server:0.8.1 .
docker build --target production -f apps/web/Dockerfile -t yoppi-web:0.8.1 \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
```

For a local production-mode smoke test:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000 \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

A real deployment should supply production secrets, managed PostgreSQL, HTTPS, a custom domain, and the correct public API origin. Set `TRUST_PROXY=true` only when the API is actually behind a trusted reverse proxy/load balancer.

## Hardening configuration

Relevant environment variables:

```env
LOG_LEVEL=info
TRUST_PROXY=false
HTTP_RATE_LIMIT_MAX=240
HTTP_RATE_LIMIT_WINDOW_MS=60000
SOCKET_RATE_LIMIT_MAX=120
SOCKET_RATE_LIMIT_WINDOW_MS=10000
BODY_LIMIT_BYTES=32768
SHUTDOWN_GRACE_MS=10000
ROOM_MINIMUM_PLAYER_GRACE_MS=15000
POKER_TURN_TIMEOUT_MS=30000
```

The in-memory rate limiters are appropriate for the current single-server architecture. They must move to a shared/distributed implementation when Yoppi adds multiple API instances.

## Persistence boundary

PostgreSQL persists room membership, participation, host ownership, and `GameSession` history. Live Blackjack and Poker state remain in the server process. A server restart during an active round/hand still loses that round/hand; durable active-game recovery remains a later reliability milestone.

## Next milestone

v0.9 should focus on deployment and operations: select a container hosting platform, provision managed PostgreSQL, establish staging/production environments, configure HTTPS/domains/secrets/backups, centralize logs/error reporting, and define deployment/rollback procedures.
