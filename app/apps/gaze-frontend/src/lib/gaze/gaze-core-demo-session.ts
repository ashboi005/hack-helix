export type GazeCoreDemoSession = {
  email: string
  authToken: string
  userId: string
  userName: string
  uuid: string
  token: string
  expiresAt: string
  expiresInSeconds: number
  websocketUrl?: string
}

export type GazeDemoRouteStep = "signup" | "login" | "me" | "eye-token"

type FocusLayerUser = {
  id: string
  email: string
  name: string
  kbId: string | null
}

type FocusLayerAuthPayload = {
  token: string
  user: FocusLayerUser
}

type FocusLayerEyeTokenPayload = {
  token: string
  uuid: string
  expiresAt: string
  expiresInSeconds: number
  websocketUrl?: string
}

type ApiErrorPayload = {
  message?: string
  error?: string
  code?: string
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/g, "")
  if (!trimmed) {
    throw new Error("A backend base URL is required.")
  }

  return trimmed
}

function buildRouteUrl(baseUrl: string, routePath: string) {
  return new URL(routePath, `${normalizeBaseUrl(baseUrl)}/`).toString()
}

function extractErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") return fallbackMessage

  const record = payload as Record<string, unknown>
  if (typeof record.message === "string" && record.message.trim()) return record.message
  if (typeof record.error === "string" && record.error.trim()) return record.error
  if (typeof record.code === "string" && record.code.trim()) return record.code
  return fallbackMessage
}

function isConflictError(payload: ApiErrorPayload | null, status: number) {
  if (status === 409) return true
  return payload?.code === "EMAIL_ALREADY_IN_USE"
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function deriveNameFromEmail(email: string) {
  const [local] = normalizeEmail(email).split("@")
  const readable = (local || "FocusLayer User").replace(/[._-]+/g, " ").trim()
  return readable || "FocusLayer User"
}

function ensurePassword(password: string) {
  const value = password.trim()
  if (value.length < 8) {
    throw new Error("Password must be at least 8 characters.")
  }

  return value
}

async function readJsonPayload(response: Response) {
  return await response.json().catch(() => null) as Record<string, unknown> | null
}

async function signUpFocusLayer(baseUrl: string, payload: { email: string; password: string; name: string }) {
  const response = await fetch(buildRouteUrl(baseUrl, "/auth/signup"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const body = await readJsonPayload(response) as FocusLayerAuthPayload | ApiErrorPayload | null

  if (!response.ok) {
    if (isConflictError(body as ApiErrorPayload | null, response.status)) {
      return null
    }

    throw new Error(extractErrorMessage(body, "Unable to create a FocusLayer account."))
  }

  if (!body || typeof body !== "object" || typeof (body as FocusLayerAuthPayload).token !== "string") {
    throw new Error("FocusLayer signup returned an invalid response.")
  }

  return body as FocusLayerAuthPayload
}

async function loginFocusLayer(baseUrl: string, payload: { email: string; password: string }) {
  const response = await fetch(buildRouteUrl(baseUrl, "/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const body = await readJsonPayload(response) as FocusLayerAuthPayload | ApiErrorPayload | null

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, "Unable to sign in to FocusLayer."))
  }

  if (!body || typeof body !== "object" || typeof (body as FocusLayerAuthPayload).token !== "string") {
    throw new Error("FocusLayer login returned an invalid response.")
  }

  return body as FocusLayerAuthPayload
}

async function fetchCurrentUser(baseUrl: string, authToken: string) {
  const response = await fetch(buildRouteUrl(baseUrl, "/me"), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })

  const body = await readJsonPayload(response) as FocusLayerUser | ApiErrorPayload | null

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, "Unable to fetch the authenticated FocusLayer profile."))
  }

  if (!body || typeof body !== "object" || typeof (body as FocusLayerUser).id !== "string") {
    throw new Error("FocusLayer profile response is invalid.")
  }

  return body as FocusLayerUser
}

async function issueEyeToken(baseUrl: string, authToken: string) {
  const response = await fetch(buildRouteUrl(baseUrl, "/eye/token"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })

  const body = await readJsonPayload(response) as FocusLayerEyeTokenPayload | ApiErrorPayload | null

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, "Unable to issue the gaze access token."))
  }

  if (!body || typeof body !== "object" || typeof (body as FocusLayerEyeTokenPayload).token !== "string") {
    throw new Error("The eye token endpoint returned an invalid response.")
  }

  return body as FocusLayerEyeTokenPayload
}

export async function issueDemoGazeSession(input: {
  backendBaseUrl: string
  email: string
  password: string
  name?: string
  onProgress?: (step: GazeDemoRouteStep) => void
}) {
  const backendBaseUrl = normalizeBaseUrl(input.backendBaseUrl)
  const email = normalizeEmail(input.email)
  if (!email) {
    throw new Error("A test email is required.")
  }

  const password = ensurePassword(input.password)
  const name = input.name?.trim() || deriveNameFromEmail(email)

  input.onProgress?.("signup")
  await signUpFocusLayer(backendBaseUrl, {
    email,
    password,
    name,
  })

  input.onProgress?.("login")
  const loginResult = await loginFocusLayer(backendBaseUrl, {
    email,
    password,
  })

  input.onProgress?.("me")
  const currentUser = await fetchCurrentUser(backendBaseUrl, loginResult.token)

  input.onProgress?.("eye-token")
  const eyeToken = await issueEyeToken(backendBaseUrl, loginResult.token)

  return {
    email: currentUser.email,
    authToken: loginResult.token,
    userId: currentUser.id,
    userName: currentUser.name,
    uuid: eyeToken.uuid,
    token: eyeToken.token,
    expiresAt: eyeToken.expiresAt,
    expiresInSeconds: eyeToken.expiresInSeconds,
    websocketUrl: eyeToken.websocketUrl,
  } as GazeCoreDemoSession
}
