FROM node:22-alpine AS base

ENV COREPACK_HOME=/opt/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@10.0.0 --activate \
  && chmod -R a+rX "$COREPACK_HOME"
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/game-types/package.json packages/game-types/package.json
COPY packages/config/package.json packages/config/package.json

RUN pnpm install --frozen-lockfile

FROM base AS development
COPY . .
RUN pnpm --filter @yoppi/server prisma:generate
EXPOSE 4000
CMD ["sh", "-c", "pnpm --filter @yoppi/server prisma:migrate:deploy && pnpm --filter @yoppi/server dev"]

FROM base AS build
COPY . .
RUN pnpm --filter @yoppi/server prisma:generate \
  && pnpm --filter @yoppi/server build

FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV COREPACK_HOME=/opt/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@10.0.0 --activate \
  && chmod -R a+rX "$COREPACK_HOME"
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
CMD ["sh", "-c", "pnpm --filter @yoppi/server prisma:migrate:deploy && node apps/server/dist/server.js"]
