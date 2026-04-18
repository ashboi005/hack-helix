import { Elysia, t } from "elysia";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { env } from "@/utils/env";

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