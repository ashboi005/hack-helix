import { Elysia, t } from "elysia";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { env } from "@/utils/env";

async function issueGazeToken(userId: string) {
  const response = await fetch(new URL("/api/gaze/token", env.GAZE_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: env.GAZE_API_KEY,
      metadata: {
        uuid: userId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error("gaze_backend_unavailable");
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || typeof Reflect.get(payload, "token") !== "string") {
    throw new Error("gaze_backend_unavailable");
  }

  return payload as { token: string };
}

async function proxyGazeRequest(pathname: string, userId: string, body?: unknown) {
  const issuedToken = await issueGazeToken(userId);
  const response = await fetch(new URL(pathname, env.GAZE_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${issuedToken.token}`,
      ...(typeof body === "undefined" ? {} : { "Content-Type": "application/json" }),
    },
    ...(typeof body === "undefined" ? {} : { body: JSON.stringify(body) }),
  });

  const payload = await response.json().catch(() => null);
  return { response, payload };
}

const serviceUnavailableResponse = t.Object({
  error: t.Literal("gaze_backend_unavailable"),
  code: t.Literal("GAZE_BACKEND_UNAVAILABLE"),
});

export const eyeRoutes = new Elysia({ prefix: "/eye", tags: ["Eye"] })
  .use(authContextPlugin)
  .post(
    "/token",
    async ({ currentUser, set }) => {
      try {
        const response = await fetch(new URL("/api/gaze/token", env.GAZE_BASE_URL), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            apiKey: env.GAZE_API_KEY,
            metadata: {
              uuid: currentUser.id,
            },
          }),
        });

        if (!response.ok) {
          throw new Error("gaze_backend_unavailable");
        }

        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          return await response.json();
        }

        return await response.text();
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
        503: serviceUnavailableResponse,
      },
      detail: {
        summary: "Proxy token creation for the external gaze tracking backend",
      },
    },
  )
  .post(
    "/calibration/record/start",
    async ({ body, currentUser, set }) => {
      try {
        const { response, payload } = await proxyGazeRequest("/api/gaze/calibration/record/start", currentUser.id, body);
        set.status = response.status;
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
      auth: true,
      body: t.Object({
        pointIndex: t.Number(),
        target: t.Tuple([t.Number(), t.Number()]),
        durationMs: t.Number(),
        startedAt: t.Number(),
      }),
      response: {
        200: t.Any(),
        401: t.Any(),
        422: t.Any(),
        503: t.Any(),
      },
      detail: {
        summary: "Start a synchronized calibration point capture",
      },
    },
  )
  .post(
    "/calibration/record/complete",
    async ({ body, currentUser, set }) => {
      try {
        const { response, payload } = await proxyGazeRequest("/api/gaze/calibration/record/complete", currentUser.id, body);
        set.status = response.status;
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
      auth: true,
      body: t.Object({
        captureId: t.String(),
        pointIndex: t.Number(),
        screen: t.Tuple([t.Number(), t.Number()]),
        gaze: t.Tuple([t.Number(), t.Number(), t.Number()]),
        gazeSampleCount: t.Number(),
        startedAt: t.Number(),
        endedAt: t.Number(),
        capturedAt: t.Number(),
      }),
      response: {
        200: t.Any(),
        401: t.Any(),
        404: t.Any(),
        409: t.Any(),
        422: t.Any(),
        503: t.Any(),
      },
      detail: {
        summary: "Complete a synchronized calibration point capture",
      },
    },
  )
  .post(
    "/calibration/phase-zero-settle",
    async ({ currentUser, set }) => {
      try {
        const { response, payload } = await proxyGazeRequest("/api/gaze/calibration/phase-zero-settle", currentUser.id);
        set.status = response.status;
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
      auth: true,
      response: {
        200: t.Any(),
        401: t.Any(),
        503: t.Any(),
      },
      detail: {
        summary: "Re-anchor the current face pose as the neutral baseline",
      },
    },
  );
