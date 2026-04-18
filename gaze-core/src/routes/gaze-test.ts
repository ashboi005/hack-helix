import { sql } from "drizzle-orm"
import { Elysia, t } from "elysia"
import { db } from "../db"
import { user } from "../db/schema"
import { validateGazeApiKey, GazeApiKeyError } from "../lib/gaze-api-key"
import { buildWebSocketUrlFromRequest, gazeConfig } from "../lib/gaze-config"
import { deriveTestUuidFromEmail } from "../lib/gaze-email-uuid"
import { issueGazeAccessToken } from "../lib/gaze-token"

const testTokenIssuerBodySchema = t.Object({
  email: t.String({ minLength: 3 }),
  apiKey: t.Optional(t.String({ minLength: 1 })),
  password: t.Optional(t.String({ minLength: 1 })),
})

function errorResponse(error: string, message: string) {
  return { error, message }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

async function findUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email)

  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      hardwarePasswordHash: user.hardwarePasswordHash,
    })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .limit(1)

  return rows[0] ?? null
}

export const gazeTestRoutes = new Elysia({ prefix: "/gaze/test/validate" })
  .post(
    "/uuid",
    async ({ body, request, set }) => {
      try {
        const normalizedEmail = normalizeEmail(body.email)
        if (!normalizedEmail) {
          set.status = 400
          return errorResponse("VALIDATION_ERROR", "Email is required.")
        }

        const requestedPassword = body.password?.trim()

        let referenceId = normalizedEmail
        let apiKeyId = "hardware-password"

        if (requestedPassword) {
          const matchedUser = await findUserByEmail(normalizedEmail)
          if (!matchedUser) {
            set.status = 404
            return errorResponse("NOT_FOUND", "User not found.")
          }

          if (!matchedUser.hardwarePasswordHash) {
            set.status = 403
            return errorResponse("HARDWARE_PASSWORD_NOT_SET", "No hardware password is configured for this user.")
          }

          const passwordMatches = await Bun.password.verify(requestedPassword, matchedUser.hardwarePasswordHash)
          if (!passwordMatches) {
            set.status = 401
            return errorResponse("INVALID_CREDENTIALS", "Invalid hardware password.")
          }

          referenceId = matchedUser.id
        } else {
          const requestedApiKey = body.apiKey?.trim()
          if (!requestedApiKey) {
            set.status = 400
            return errorResponse("VALIDATION_ERROR", "Provide either email + password or apiKey + email.")
          }

          const apiKeyRecord = await validateGazeApiKey(requestedApiKey)
          referenceId = apiKeyRecord.referenceId
          apiKeyId = apiKeyRecord.id
        }

        const identity = deriveTestUuidFromEmail(normalizedEmail)

        const issuedToken = issueGazeAccessToken({
          uuid: identity.uuid,
          apiKeyId,
          referenceId,
        })

        return {
          email: identity.email,
          uuid: identity.uuid,
          token: issuedToken.token,
          expiresAt: new Date(issuedToken.expiresAt).toISOString(),
          expiresInSeconds: gazeConfig.tokenTtlSeconds,
          websocketUrl: buildWebSocketUrlFromRequest(request),
        }
      } catch (error) {
        if (error instanceof GazeApiKeyError) {
          set.status = error.status
          return errorResponse(error.code, error.message)
        }

        const message = error instanceof Error ? error.message : "Unable to issue a test websocket access token."
        console.error("[GAZE] test token issuer failed:", error)
        set.status = 500
        return errorResponse("TEST_TOKEN_ISSUER_FAILED", message)
      }
    },
    {
      body: testTokenIssuerBodySchema,
      detail: {
        tags: ["Gaze Test"],
      },
      response: {
        400: t.Object({
          error: t.String(),
          message: t.String(),
        }),
        401: t.Object({
          error: t.String(),
          message: t.String(),
        }),
        403: t.Object({
          error: t.String(),
          message: t.String(),
        }),
        404: t.Object({
          error: t.String(),
          message: t.String(),
        }),
        500: t.Object({
          error: t.String(),
          message: t.String(),
        }),
      },
    },
  )
