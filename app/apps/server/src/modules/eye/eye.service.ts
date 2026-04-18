import { env } from "@/utils/env";
import { ApiError } from "@/utils/api-error";

function getTokenPayload(payload: unknown): { token: string; expiresIn: number } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const token = Reflect.get(payload, "token") ?? Reflect.get(Reflect.get(payload, "data"), "token");
  const expiresIn = Reflect.get(payload, "expiresIn") ?? Reflect.get(Reflect.get(payload, "data"), "expiresIn");

  if (typeof token !== "string" || typeof expiresIn !== "number") {
    return null;
  }

  return { token, expiresIn };
}

export async function createEyeSessionToken(userId: string, sessionId: string): Promise<{ token: string; expiresIn: number }> {
  const response = await fetch(new URL("/api/sessions", env.EYE_BACKEND_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EYE_BACKEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
      sessionId,
    }),
  });

  if (!response.ok) {
    throw new ApiError(503, "eye_backend_unavailable", "EYE_BACKEND_UNAVAILABLE");
  }

  const payload = await response.json().catch(() => null);
  const tokenPayload = getTokenPayload(payload);

  if (!tokenPayload) {
    throw new ApiError(503, "eye_backend_unavailable", "EYE_BACKEND_UNAVAILABLE");
  }

  return tokenPayload;
}