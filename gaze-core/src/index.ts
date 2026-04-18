import { swagger } from "@elysiajs/swagger"
import { Elysia } from "elysia"
import { auth } from "./lib/auth"
import { createAuthPlugin } from "./lib/middleware"
import { gazeMqttBridge } from "./lib/gaze-mqtt"
import { gazeTestRoutes } from "./routes/gaze-test"
import { gazeRoutes } from "./routes/gaze"
import { userRoutes } from "./routes/user"

const port = Number(process.env.PORT ?? "3000")

/**
 * GazeCore Backend - Main Server
 * Route-first architecture
 */
function normalizeAuthOpenApiSchema(schema: Awaited<ReturnType<typeof auth.api.generateOpenAPISchema>>) {
  const authPaths = Object.fromEntries(
    Object.entries(schema.paths ?? {}).map(([path, pathItem]) => [
      path,
      Object.fromEntries(
        Object.entries(pathItem ?? {}).map(([method, operation]) => {
          if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
            return [method, operation]
          }

          return [method, { ...operation, tags: ["Auth"] }]
        }),
      ),
    ]),
  )

  return {
    paths: authPaths,
    components: schema.components,
    tags: [{ name: "Auth", description: "Authentication and account management endpoints" }],
  }
}

const gazeWebSocketDocs = {
  "/api/gaze/screen/ws": {
    get: {
      tags: ["Gaze"],
      summary: "Open the live gaze WebSocket",
      description:
        "WebSocket upgrade endpoint used by the live gaze preview. Connect with a token query parameter, then send JSON messages for session.init, gaze_vector, and ping.",
      responses: {
        101: {
          description: "WebSocket upgrade successful",
        },
      },
    },
  },
}

const authOpenApiSchema = normalizeAuthOpenApiSchema(await auth.api.generateOpenAPISchema())

const app = new Elysia()
  .onAfterHandle(({ request, response, set }) => {
    const url = new URL(request.url)
    const status = response instanceof Response
      ? response.status
      : typeof set.status === "number"
        ? set.status
        : 200

    console.log(`[REQ] ${request.method} ${url.pathname} -> ${status}`)
  })
  .use(createAuthPlugin())
  .use(
    swagger({
      path: "/swagger",
      documentation: {
        info: {
          title: "GazeCore API",
          version: "1.0.0",
          description: "Swagger UI for the GazeCore backend API.",
        },
        paths: {
          ...authOpenApiSchema.paths,
          ...gazeWebSocketDocs,
        },
        components: authOpenApiSchema.components as never,
        tags: [
          { name: "App", description: "Health and root endpoints" },
          ...authOpenApiSchema.tags,
          { name: "Users", description: "User profile routes" },
          { name: "Gaze", description: "Gaze token, snapshot, and websocket routes" },
          { name: "Gaze Test", description: "Test-only gaze validation routes" },
        ],
      },
    }),
  )
  .get(
    "/",
    () => ({
      message: "GazeCore Backend API",
      version: "1.0.0",
      status: "running",
    }),
    {
      detail: {
        tags: ["App"],
      },
    },
  )
  .get(
    "/health",
    () => ({
      status: "healthy",
      timestamp: new Date().toISOString(),
    }),
    {
      detail: {
        tags: ["App"],
      },
    },
  )
  .group("/api", (group) =>
    group
      .use(userRoutes)
      .use(gazeTestRoutes)
      .use(gazeRoutes),
  )
  .listen(port)

process.on("SIGINT", () => {
  gazeMqttBridge.close()
  process.exit(0)
})

process.on("SIGTERM", () => {
  gazeMqttBridge.close()
  process.exit(0)
})

console.log(`
GazeCore backend is running at http://localhost:${port}
Better Auth: http://localhost:${port}/api/auth
Health Check: http://localhost:${port}/health
Swagger: http://localhost:${port}/swagger
Gaze Routes: http://localhost:${port}/api/gaze
Live Gaze WS: ws://localhost:${port}/api/gaze/screen/ws
`)
