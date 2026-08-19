# Yoppi deployment baseline (v0.9)

This directory defines the provider-neutral deployment model for Yoppi. It targets one Docker-capable Linux host for the application tier plus an external managed PostgreSQL database.

## Topology

```text
Internet
   |
   | 80 / 443
   v
 Caddy
   |-------------------|
   |                   |
 /api/*             everything else
 /socket.io/*           |
   |                   v
 Fastify              Next.js
   |
   v
Managed PostgreSQL
```

Caddy terminates TLS and automatically supports WebSocket upgrades. Keeping the browser and API on the same public origin removes production CORS/cookie complexity. The production web image therefore uses relative API and Socket.IO URLs and can be promoted between staging and production without rebuilding it for a new domain.

## Infrastructure requirements

Application host:

- Linux host/VM with Docker Engine and the Docker Compose plugin
- inbound TCP 80 and 443; UDP 443 is recommended for HTTP/3
- outbound HTTPS for GHCR image pulls and ACME certificate issuance
- outbound PostgreSQL connectivity to the managed database
- persistent local storage for Caddy certificate state
- enough memory/CPU for one Next.js container, one Fastify container, and Caddy

Database:

- managed PostgreSQL compatible with the Prisma schema
- TLS required in `DATABASE_URL` where supported
- automated provider backups enabled
- retention policy appropriate to the deployment environment
- network access restricted to the Yoppi application host where the provider supports it

DNS:

- `YOPPI_DOMAIN` must resolve to the application host before Caddy can obtain a public certificate

## Production environment

Copy `.env.production.example` to `.env.production` on the deployment host and populate real values. Never commit `.env.production`.

At minimum set:

```env
YOPPI_DOMAIN=yoppi.example.com
YOPPI_REGISTRY=ghcr.io/your-github-user-or-org
YOPPI_VERSION=v0.9.0
DATABASE_URL=postgresql://...
SESSION_SECRET=...
```

Generate a session secret with a cryptographically secure source, for example:

```bash
openssl rand -base64 48
```

The deployment host must be able to pull the configured GHCR packages. Public packages require no login. Private packages require a GHCR token with package-read permission:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
```

## Release flow

1. Merge only code that passes `.github/workflows/ci.yml`.
2. Tag the release, for example `v0.9.0`.
3. `.github/workflows/release-images.yml` verifies the repository and publishes immutable web/server images to GHCR.
4. Deploy that exact image version to staging.
5. Run multiplayer smoke/E2E testing against staging.
6. Deploy the same immutable version to production using `.github/workflows/deploy.yml` or `./ops/deploy.sh`.

Application images are also tagged as `sha-<git-sha>` for traceability.

## First host deployment

On the host, create the deployment directory and copy these files into it:

```text
docker-compose.deploy.yml
deploy/Caddyfile
ops/
.env.production
```

Then:

```bash
chmod +x ops/*.sh
./ops/deploy.sh v0.9.0
```

The script pulls immutable images, starts the stack, and waits for:

```text
https://$YOPPI_DOMAIN/api/v1/health
https://$YOPPI_DOMAIN/api/v1/ready
https://$YOPPI_DOMAIN/
```

If a new version fails those checks and a previous successful version is recorded, the script attempts an automatic application-image rollback.

## GitHub deployment environments

The manual `Deploy Yoppi` workflow expects GitHub environments named `staging` and `production`. Configure the same secret names separately in each environment:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_PATH
DEPLOY_SSH_KEY
DEPLOY_KNOWN_HOSTS
```

`DEPLOY_PATH` should be an absolute path without shell metacharacters (for example `/opt/yoppi`).

`DEPLOY_KNOWN_HOSTS` should contain the pre-verified SSH host key for the target. Avoid replacing it with automatic `ssh-keyscan` inside CI because that defeats host-key verification.

The target host keeps its own `.env.production`; the workflow intentionally does not copy production secrets from the repository.

## Rollback

Rollback only changes application images:

```bash
./ops/rollback.sh
```

or explicitly:

```bash
./ops/rollback.sh v0.8.1
```

Prisma migrations are currently applied by the API container before startup. Therefore schema changes made before v1.0 should remain backward-compatible with at least the previous application release. An application rollback does not reverse database migrations.

A database restore is a separate destructive operation and requires an explicit confirmation variable.

## Backups

Managed PostgreSQL automated backups are the primary recovery mechanism. `ops/backup-db.sh` provides an additional portable logical backup:

```bash
./ops/backup-db.sh
```

It creates a timestamped PostgreSQL custom-format dump under `backups/`. Copy important backups away from the application host to durable object storage or another protected location.

Restore only during an incident or controlled recovery exercise:

```bash
RESTORE_CONFIRM=restore-yoppi ./ops/restore-db.sh backups/yoppi-YYYYMMDDTHHMMSSZ.dump
```

Run a restore drill in staging before relying on this process for production recovery.

## Logs and error reporting

Fastify/Pino and Caddy both emit structured logs to stdout/stderr. The hosting platform or host-level log agent should forward container logs to a centralized service and retain them outside the VM.

Alerts should at minimum cover:

- API container restarts/unhealthy state
- HTTP 5xx spikes
- `http.unhandled_error`
- uncaught process failures
- readiness failures
- PostgreSQL connectivity failures
- sustained Socket.IO disconnect/error spikes
- disk pressure on the application host

The repository intentionally does not hard-code a commercial error-reporting/logging vendor in v0.9. A provider-specific integration can be added once the deployment provider is selected and its current offering is verified.

## Deployment caveat: active games

Blackjack and Poker hand/round state remains in the single Fastify process. Restarting or replacing the API container terminates active games. Until durable game-state recovery or a drain mechanism exists:

- treat production deployments as maintenance events
- announce a short maintenance window
- avoid deploying while active rooms are in use
- expect connected clients to reconnect to room metadata after the server returns, while the interrupted hand/round itself cannot be recovered

Zero-downtime rolling deployment is intentionally deferred until game state can survive process replacement.
