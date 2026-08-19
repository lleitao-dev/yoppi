# Yoppi Online Casino — Deployment Baseline v0.9.0

Yoppi is a multiplayer, play-money casino platform with server-authoritative Blackjack and No-Limit Texas Hold'em. v0.9.0 takes the working/hardened MVP and adds a provider-neutral release and deployment system suitable for staging and an initial single-host production environment.

## Current stack

- TypeScript monorepo with pnpm workspaces
- Next.js + React + Tailwind CSS frontend
- Fastify + Socket.IO authoritative game server
- Zod protocol/environment validation
- PostgreSQL + Prisma persistence
- Vitest + Playwright automated tests
- Docker/Docker Compose local development
- GitHub Actions CI
- immutable OCI production images published to GHCR
- Caddy production edge proxy with automatic HTTPS and WebSocket proxying

## Product scope

- guest identities using secure HTTP-only sessions
- private rooms with room codes
- reconnect, active host transfer, deliberate leave, queued joins, and game-specific admission boundaries
- server-authoritative Blackjack for 1–5 players
- server-authoritative No-Limit Texas Hold'em for 2–6 players
- play chips only; no deposits, purchases, withdrawals, redemption, cryptocurrency, or transferable balances

## Local development

Requirements: Docker with Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Web: http://localhost:3000
- Liveness: http://localhost:4000/api/v1/health
- Readiness: http://localhost:4000/api/v1/ready

Expected:

```json
{"status":"ok"}
```

```json
{"status":"ready"}
```

## Quality gates

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

GitHub Actions runs the build/test gates on `main` and pull requests. High-severity dependency audit findings remain advisory until the dedicated dependency-upgrade cycle is complete.

## Local production-image smoke test

The ordinary Compose file uses hot-reload development targets. To exercise production Docker targets locally:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000 \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

The public production topology is different: browser and API traffic share one HTTPS origin behind Caddy. The web image therefore defaults to relative API/Socket.IO URLs and is portable between domains.

## Release images

Tagging a release such as:

```bash
git tag v0.9.0
git push origin v0.9.0
```

triggers `.github/workflows/release-images.yml`, which verifies the repository and publishes:

```text
ghcr.io/<owner>/yoppi-server:v0.9.0
ghcr.io/<owner>/yoppi-web:v0.9.0
```

plus commit-SHA tags for traceability.

## Deployment

The production baseline uses:

```text
Internet
   |
 Caddy (HTTPS)
   |-----------------|
 Fastify           Next.js
   |
Managed PostgreSQL
```

Relevant files:

```text
docker-compose.deploy.yml
.env.production.example
deploy/Caddyfile
deploy/README.md
ops/deploy.sh
ops/rollback.sh
ops/smoke-test.sh
ops/backup-db.sh
ops/restore-db.sh
.github/workflows/deploy.yml
```

See [deploy/README.md](deploy/README.md) for DNS, TLS, secrets, GHCR, managed PostgreSQL, staging/production GitHub environments, backups, deployment, and rollback procedures.

## Operational boundary

Fastify and Caddy emit structured logs to stdout/stderr for collection by the chosen hosting/logging platform. The repository does not bind v0.9 to a commercial monitoring vendor because the deployment provider has not yet been selected and live provider verification is unavailable in this session.

Active Blackjack/Poker state remains in the server process. Replacing the API container interrupts active hands/rounds. v0.9 deployments therefore require a short maintenance window until durable active-game recovery or a server-drain mechanism is implemented.

## Next milestone

After v0.9 is deployed successfully to staging, the next milestone is v1.0 public-MVP readiness: production policy/legal pages, age/play-money acknowledgement, minimal administration/moderation controls, deployment monitoring/alerts, restore drills, browser/device acceptance testing, and a controlled public launch checklist.
