# syntax=docker/dockerfile:1

FROM oven/bun:1 AS build
WORKDIR /app

# Build with monorepo context rooted at /app
COPY bun.lock package.json tsconfig.json bts.jsonc ./
COPY packages ./packages
COPY apps ./apps

RUN bun install
RUN bun run --cwd apps/server build

FROM oven/bun:1 AS runtime
WORKDIR /app/apps/server

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/server/package.json ./package.json
COPY --from=build /app/apps/server/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist

EXPOSE 3000

CMD ["bun", "run", "dist/index.mjs"]
