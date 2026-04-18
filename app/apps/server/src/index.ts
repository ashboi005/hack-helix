import { auth } from "@app/auth";
import { env } from "@app/env/server";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

const app = new Elysia()
  .use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  .use(
    openapi({
      info: { title: "HackHelix API", version: "1.0.0" },
    }),
  )
  .use(
    swagger({ path: "/docs" }),
  )
  .all("/api/auth/*", async (context) => {
    const { request, status } = context;
    if (["POST", "GET"].includes(request.method)) {
      return auth.handler(request);
    }
    return status(405);
  })
  .get("/", () => "Cracked Nerds for the winnnnnn RAHHHHH")
  .listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
  });
