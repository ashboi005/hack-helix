import { defaultKeyHasher } from "@better-auth/api-key"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { apikey } from "@/db/schema"

export class GazeApiKeyError extends Error {
  constructor(
    message: string,
    readonly status: number = 401,
    readonly code: string = "INVALID_API_KEY",
  ) {
    super(message)
    this.name = "GazeApiKeyError"
  }
}

export async function validateGazeApiKey(rawApiKey: string) {
  const normalizedApiKey = rawApiKey.trim()
  if (!normalizedApiKey) {
    throw new GazeApiKeyError("API key is required.")
  }

  const hashedApiKey = await defaultKeyHasher(normalizedApiKey)
  const rows = await db
    .select()
    .from(apikey)
    .where(eq(apikey.key, hashedApiKey))
    .limit(1)

  const record = rows[0]
  if (!record) {
    throw new GazeApiKeyError("Invalid API key.")
  }

  if (record.enabled === false) {
    throw new GazeApiKeyError("This API key has been disabled.")
  }

  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    throw new GazeApiKeyError("This API key has expired.")
  }

  await db
    .update(apikey)
    .set({
      lastRequest: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(apikey.id, record.id))

  return record
}
