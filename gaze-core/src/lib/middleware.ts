import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { sql } from "drizzle-orm";
import { auth } from "./auth";
import { AUTH_MESSAGES } from "./auth-messages";
import { validateEmailDomain } from "./email-validator";
import { db } from "@/db";
import { user } from "@/db/schema";
import type { EmailRequestBody, MiddlewareErrorResponse, UserIdLookupResult } from "@/types/middleware";

async function getNormalizedEmailFromRequest(request: Request): Promise<string | null> {
  const body = (await request.clone().json()) as EmailRequestBody
  if (!body.email) {
    return null
  }

  return body.email.trim().toLowerCase()
}

async function findUserByEmail(email: string): Promise<UserIdLookupResult | null> {
  const existingUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`)
    .limit(1)

  return existingUsers[0] ?? null
}

function serviceUnavailableResponse(): MiddlewareErrorResponse {
  return {
    error: {
      message: AUTH_MESSAGES.serviceUnavailable,
    },
  }
}

/**
 * Better Auth Elysia plugin with CORS
 * Provides:
 * - CORS configuration for frontend communication
 * - Auth handler mounting
 * - Email domain validation for sign-up
 * - User/session available in all routes via derive
 */
export const createAuthPlugin = () =>
  new Elysia({ name: "better-auth-plugin" })
    .use(
      cors({
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      })
    )
    .onBeforeHandle(async ({ request, path, set }) => {
      // Validate email domain on sign-up requests
      if (request.method === "POST" && path === "/api/auth/sign-up/email") {
        try {
          const normalizedEmail = await getNormalizedEmailFromRequest(request)

          if (normalizedEmail) {
            const domainError = await validateEmailDomain(normalizedEmail)
            if (domainError) {
              set.status = 400
              return { error: { message: domainError } }
            }

            try {
              const existingUser = await findUserByEmail(normalizedEmail)
              if (existingUser) {
                set.status = 409
                return {
                  error: {
                    message: AUTH_MESSAGES.emailAlreadyRegistered,
                  },
                }
              }
            } catch (dbError) {
              console.error("❌ DB error during sign-up email existence check:", dbError)
              set.status = 503
              return serviceUnavailableResponse()
            }
          }
        } catch (error) {
          // If body parsing fails, let Better Auth handle it
          console.error("❌ Error validating email domain:", error)
        }
      }

      // Return explicit not-found message before password validation on sign-in.
      if (request.method === "POST" && path === "/api/auth/sign-in/email") {
        try {
          const normalizedEmail = await getNormalizedEmailFromRequest(request)

          if (normalizedEmail) {
            try {
              const existingUser = await findUserByEmail(normalizedEmail)
              if (!existingUser) {
                set.status = 404
                return {
                  error: {
                    message: AUTH_MESSAGES.userDoesNotExist,
                  },
                }
              }
            } catch (dbError) {
              console.error("❌ DB error during sign-in user existence check:", dbError)
              set.status = 503
              return serviceUnavailableResponse()
            }
          }
        } catch (error) {
          // If body parsing fails, let Better Auth handle it.
          console.error("❌ Error checking sign-in user existence:", error)
        }
      }
    })
    .mount(auth.handler)
    .derive(async ({ request: { headers } }) => {
      /**
       * Get session from request headers
       * Returns user and session if authenticated, null otherwise
       * Available in all routes as { user, session }
       */
      try {
        const sessionData = await auth.api.getSession({ headers });
        return {
          user: sessionData?.user || null,
          session: sessionData?.session || null,
        };
      } catch {
        return {
          user: null,
          session: null,
        };
      }
    });
