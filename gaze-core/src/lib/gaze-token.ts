import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { gazeConfig } from "./gaze-config"
import type { GazeAccessTokenClaims } from "./gaze-types"
import type { GazeAccessTokenIssueInput, TokenPayloadRecord } from "../types/gaze-token"

const JWT_HEADER = {
  alg: "HS256",
  typ: "JWT",
} as const

export class GazeTokenError extends Error {
  constructor(
    message: string,
    readonly status: number = 401,
    readonly code: string = "INVALID_TOKEN",
  ) {
    super(message)
    this.name = "GazeTokenError"
  }
}

function encodeBase64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, "base64")
}

function signTokenSegment(unsignedToken: string) {
  return encodeBase64Url(
    createHmac("sha256", gazeConfig.tokenSecret)
      .update(unsignedToken)
      .digest(),
  )
}

function assertClaimString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new GazeTokenError(message)
  }

  return value
}

function assertClaimNumber(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GazeTokenError(message)
  }

  return value
}

export function issueGazeAccessToken(input: GazeAccessTokenIssueInput) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const claims: GazeAccessTokenClaims = {
    sub: input.uuid,
    uuid: input.uuid,
    scope: "gaze:session",
    iss: gazeConfig.tokenIssuer,
    aud: gazeConfig.tokenAudience,
    iat: nowSeconds,
    exp: nowSeconds + gazeConfig.tokenTtlSeconds,
    jti: randomUUID(),
    apiKeyId: input.apiKeyId,
    referenceId: input.referenceId,
  }

  const headerPart = encodeBase64Url(JSON.stringify(JWT_HEADER))
  const payloadPart = encodeBase64Url(JSON.stringify(claims))
  const unsignedToken = `${headerPart}.${payloadPart}`
  const signature = signTokenSegment(unsignedToken)

  return {
    token: `${unsignedToken}.${signature}`,
    claims,
    expiresAt: claims.exp * 1000,
  }
}

export function verifyGazeAccessToken(rawToken: string) {
  const token = rawToken.trim()
  if (!token) {
    throw new GazeTokenError("Missing access token.", 401, "MISSING_TOKEN")
  }

  const parts = token.split(".")
  if (parts.length !== 3) {
    throw new GazeTokenError("Malformed access token.")
  }

  const [headerPart, payloadPart, signaturePart] = parts
  const expectedSignature = Buffer.from(signTokenSegment(`${headerPart}.${payloadPart}`))
  const providedSignature = Buffer.from(signaturePart)

  if (
    expectedSignature.length !== providedSignature.length
    || !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new GazeTokenError("Invalid access token signature.")
  }

  let payload: TokenPayloadRecord
  try {
    payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8")) as TokenPayloadRecord
  } catch {
    throw new GazeTokenError("Invalid access token payload.")
  }

  const scope = assertClaimString(payload.scope, "Access token scope is missing.")
  if (scope !== "gaze:session") {
    throw new GazeTokenError("Invalid access token scope.")
  }

  const issuer = assertClaimString(payload.iss, "Access token issuer is missing.")
  if (issuer !== gazeConfig.tokenIssuer) {
    throw new GazeTokenError("Invalid access token issuer.")
  }

  const audience = assertClaimString(payload.aud, "Access token audience is missing.")
  if (audience !== gazeConfig.tokenAudience) {
    throw new GazeTokenError("Invalid access token audience.")
  }

  const exp = assertClaimNumber(payload.exp, "Access token expiration is missing.")
  if (exp * 1000 <= Date.now()) {
    throw new GazeTokenError("Access token has expired.", 401, "TOKEN_EXPIRED")
  }

  return {
    sub: assertClaimString(payload.sub, "Access token subject is missing."),
    uuid: assertClaimString(payload.uuid, "Access token UUID is missing."),
    scope: "gaze:session" as const,
    iss: issuer,
    aud: audience,
    iat: assertClaimNumber(payload.iat, "Access token issued-at time is missing."),
    exp,
    jti: assertClaimString(payload.jti, "Access token id is missing."),
    apiKeyId: assertClaimString(payload.apiKeyId, "Access token API key id is missing."),
    referenceId: assertClaimString(payload.referenceId, "Access token reference id is missing."),
  }
}

export function extractBearerToken(authorizationHeader: string | undefined | null) {
  if (!authorizationHeader) return null

  const [scheme, value] = authorizationHeader.split(" ")
  if (scheme?.toLowerCase() !== "bearer" || !value?.trim()) {
    return null
  }

  return value.trim()
}
