# syntax=docker/dockerfile:1

FROM oven/bun:1 AS build
WORKDIR /app

COPY bun.lock package.json tsconfig.json drizzle.config.ts ./
COPY src ./src

RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
