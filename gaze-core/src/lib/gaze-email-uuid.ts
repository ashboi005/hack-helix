import { createHmac } from "node:crypto"
import { gazeConfig } from "./gaze-config"

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized) {
    throw new Error("Email is required to derive a test UUID.")
  }

  return normalized
}

function toUuidFromBytes(bytes: Uint8Array) {
  const view = new Uint8Array(bytes.slice(0, 16))
  view[6] = (view[6] & 0x0f) | 0x50
  view[8] = (view[8] & 0x3f) | 0x80

  const hex = Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

export function deriveTestUuidFromEmail(email: string) {
  const normalizedEmail = normalizeEmail(email)
  const digest = createHmac("sha256", gazeConfig.emailUuidSecret)
    .update(normalizedEmail)
    .digest()

  return {
    email: normalizedEmail,
    uuid: toUuidFromBytes(digest),
  }
}
