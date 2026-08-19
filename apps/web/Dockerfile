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
EXPOSE 3000
CMD ["pnpm", "--filter", "@yoppi/web", "dev"]

FROM base AS build
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm --filter @yoppi/web build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@yoppi/web", "start"]
