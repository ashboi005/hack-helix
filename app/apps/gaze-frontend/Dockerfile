# syntax=docker/dockerfile:1

FROM oven/bun:1 AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY bun.lock package.json tsconfig.json bts.jsonc ./
COPY apps ./apps
COPY packages ./packages

RUN bun install
RUN bun run --cwd apps/gaze-frontend build

FROM oven/bun:1 AS runtime
WORKDIR /app/apps/gaze-frontend

ENV NODE_ENV=production
ENV PORT=3002
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/gaze-frontend/package.json ./package.json
COPY --from=build /app/apps/gaze-frontend/.next ./.next
COPY --from=build /app/apps/gaze-frontend/public ./public
COPY --from=build /app/apps/gaze-frontend/next.config.ts ./next.config.ts

EXPOSE 3002

CMD ["bun", "run", "start"]
