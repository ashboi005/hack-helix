import { authRoutes } from "@/modules/auth/auth.routes";
import { authHandlerPlugin } from "@/modules/auth/auth.service";
import { assistanceRoutes } from "@/modules/assistance/assistance.routes";
import { documentRoutes } from "@/modules/documents/documents.routes";
import { eyeRoutes, gazeRoutes } from "@/modules/eye/eye.routes";
import { tasksRoutes } from "@/modules/tasks/tasks.routes";
import { isApiError } from "@/utils/api-error";
import { env } from "@/utils/env";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

function getValidationDetails(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const all = Reflect.get(error, "all");
  if (Array.isArray(all)) {
    return all;
  }

  const summary = Reflect.get(error, "message");
  return typeof summary === "string" ? summary : undefined;
}

const app = new Elysia({ name: "focuslayer.api" })
  .use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  .use(
    openapi({
      documentation: {
        info: { title: "FocusLayer API", version: "1.0.0" },
      },
    }),
  )
  .use(
    swagger({ path: "/docs" }),
  )
  .use(authHandlerPlugin)
  .use(authRoutes)
  .use(documentRoutes)
  .use(assistanceRoutes)
  .use(tasksRoutes)
  .use(eyeRoutes)
  .use(gazeRoutes)
  .get("/", () => ({
    name: "FocusLayer API",
    status: "ok",
  }))
  .onError(({ code, error, set }) => {
    if (isApiError(error)) {
      set.status = error.status;

      return {
        error: error.error,
        code: error.code,
        ...(typeof error.details === "undefined" ? {} : { details: error.details }),
      };
    }

    if (code === "VALIDATION") {
      set.status = 400;

      return {
        error: "validation_error",
        code: "VALIDATION_ERROR",
        details: getValidationDetails(error),
      };
    }

    if (code === "NOT_FOUND") {
      set.status = 404;

      return {
        error: "not_found",
        code: "NOT_FOUND",
      };
    }

    console.error(error);
    set.status = 500;

    return {
      error: "internal_server_error",
      code: "INTERNAL_SERVER_ERROR",
    };
  });

app.listen(env.PORT);

console.log(`FocusLayer API is running on http://localhost:${env.PORT}`);
