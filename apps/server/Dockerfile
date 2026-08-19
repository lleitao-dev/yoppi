FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/game-types/package.json packages/game-types/package.json
COPY packages/config/package.json packages/config/package.json

RUN pnpm install --no-frozen-lockfile

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
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
CMD ["sh", "-c", "pnpm --filter @yoppi/server prisma:migrate:deploy && node apps/server/dist/server.js"]
