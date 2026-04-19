import { Elysia, t } from "elysia";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { env } from "@/utils/env";

async function proxyGazeToken(uuid: string) {
  const response = await fetch(new URL("/api/gaze/token", env.GAZE_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: env.GAZE_API_KEY,
      metadata: {
        uuid,
      },
    }),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text();

  return {
    ok: response.ok,
    payload,
  };
}

export const eyeRoutes = new Elysia({ prefix: "/eye", tags: ["Eye"] })
  .use(authContextPlugin)
  .post(
    "/token",
    async ({ currentUser, set }) => {
      try {
        const proxied = await proxyGazeToken(currentUser.id);

        if (!proxied.ok) {
          throw new Error("gaze_backend_unavailable");
        }

        return proxied.payload;
      } catch {
        set.status = 503;

        return {
          error: "gaze_backend_unavailable",
          code: "GAZE_BACKEND_UNAVAILABLE",
        };
      }
    },
    {
      auth: true,
      response: {
        200: t.Any(),
        503: t.Object({
          error: t.Literal("gaze_backend_unavailable"),
          code: t.Literal("GAZE_BACKEND_UNAVAILABLE"),
        }),
      },
      detail: {
        summary: "Proxy token creation for the external gaze tracking backend",
      },
    },
  );

export const gazeRoutes = new Elysia({ prefix: "/api/gaze", tags: ["Gaze"] })
  .use(authContextPlugin)
  .post(
    "/token",
    async ({ currentUser, set }) => {
      try {
        const proxied = await proxyGazeToken(currentUser.id);

        if (!proxied.ok) {
          throw new Error("gaze_backend_unavailable");
        }

        return proxied.payload;
      } catch {
        set.status = 503;

        return {
          error: "gaze_backend_unavailable",
          code: "GAZE_BACKEND_UNAVAILABLE",
        };
      }
    },
    {
      auth: true,
      response: {
        200: t.Any(),
        503: t.Object({
          error: t.Literal("gaze_backend_unavailable"),
          code: t.Literal("GAZE_BACKEND_UNAVAILABLE"),
        }),
      },
      detail: {
        summary: "Authenticated token creation route used by gaze frontend clients",
      },
    },
  )
  .post(
    "/gyro-snapshot",
    async ({ request, set }) => {
      const authorization = request.headers.get("authorization")?.trim();

      if (!authorization) {
        set.status = 401;
        return {
          error: "missing_gaze_token",
          code: "MISSING_GAZE_TOKEN",
        };
      }

      try {
        const response = await fetch(new URL("/api/gaze/gyro-snapshot", env.GAZE_BASE_URL), {
          method: "POST",
          headers: {
            Authorization: authorization,
          },
        });

        const contentType = response.headers.get("content-type") ?? "";
        const payload = contentType.includes("application/json")
          ? await response.json().catch(() => null)
          : await response.text();

        if (!response.ok) {
          set.status = response.status;

          if (payload && typeof payload === "object") {
            return payload;
          }

          return {
            error: "gyro_snapshot_failed",
            code: "GYRO_SNAPSHOT_FAILED",
          };
        }

        return payload;
      } catch {
        set.status = 503;

        return {
          error: "gaze_backend_unavailable",
          code: "GAZE_BACKEND_UNAVAILABLE",
        };
      }
    },
    {
      response: {
        200: t.Any(),
        401: t.Object({
          error: t.Literal("missing_gaze_token"),
          code: t.Literal("MISSING_GAZE_TOKEN"),
        }),
        503: t.Object({
          error: t.Literal("gaze_backend_unavailable"),
          code: t.Literal("GAZE_BACKEND_UNAVAILABLE"),
        }),
      },
      detail: {
        summary: "Proxy gyro zero snapshot capture to GazeCore using a gaze bearer token",
      },
    },
  );