import { buildTokenRouteUrl } from "./routes"
import type { CachedAccessToken, GazeAccessTokenResponse } from "./types"

type TokenManagerConfig = {
  backendBaseUrl?: string
  apiKey?: string
  deviceUuid?: string
  initialToken?: string
}

type TokenIssueMode = "proxy-session" | "device-api-key" | "external-only"

function extractErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") return fallbackMessage

  const record = payload as Record<string, unknown>
  if (typeof record.message === "string" && record.message.trim()) return record.message
  if (typeof record.error === "string" && record.error.trim()) return record.error
  return fallbackMessage
}

function resolveTokenIssueMode(config: TokenManagerConfig): TokenIssueMode {
  if (config.backendBaseUrl?.trim() && config.apiKey?.trim() && config.deviceUuid?.trim()) {
    return "device-api-key"
  }

  if (config.backendBaseUrl?.trim()) {
    return "proxy-session"
  }

  return "external-only"
}

async function requestGazeAccessToken(config: TokenManagerConfig & { backendBaseUrl: string }) {
  const mode = resolveTokenIssueMode(config)
  if (mode === "external-only") {
    throw new Error("A backend base URL is required to issue a gaze access token.")
  }

  const requestInit: RequestInit = {
    method: "POST",
  }

  if (mode === "device-api-key") {
    requestInit.headers = {
      "Content-Type": "application/json",
    }
    requestInit.body = JSON.stringify({
      apiKey: config.apiKey,
      metadata: {
        uuid: config.deviceUuid,
      },
    })
  } else {
    requestInit.credentials = "include"
  }

  const response = await fetch(buildTokenRouteUrl(config.backendBaseUrl), requestInit)

  const payload = await response.json().catch(() => null) as GazeAccessTokenResponse | { message?: string; error?: string } | null
  if (!response.ok || !payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string") {
    throw new Error(extractErrorMessage(payload, "Unable to issue the websocket access token."))
  }

  const expiresAt = new Date(payload.expiresAt).getTime()
  if (!Number.isFinite(expiresAt)) {
    throw new Error("The backend returned an invalid websocket token expiry.")
  }

  return {
    token: payload.token,
    expiresAt,
    websocketUrl: typeof payload.websocketUrl === "string" && payload.websocketUrl.trim()
      ? payload.websocketUrl.trim()
      : undefined,
  }
}

function shouldRefreshToken(tokenState: CachedAccessToken | null) {
  if (!tokenState) return true
  if (tokenState.source === "external") return false
  return tokenState.expiresAt - Date.now() <= 5000
}

export class GazeWidgetTokenManager {
  private config: TokenManagerConfig = {}
  private cachedToken: CachedAccessToken | null = null
  private pendingRefresh: Promise<CachedAccessToken> | null = null

  updateConfig(config: TokenManagerConfig) {
    this.config = config

    if (config.initialToken?.trim()) {
      this.cachedToken = {
        token: config.initialToken.trim(),
        expiresAt: Number.POSITIVE_INFINITY,
        source: "external",
      }
      return
    }

    if (this.cachedToken?.source === "external") {
      this.cachedToken = null
    }
  }

  canIssueToken() {
    return resolveTokenIssueMode(this.config) !== "external-only"
  }

  canAuthorize() {
    return Boolean(this.cachedToken?.token) || this.canIssueToken()
  }

  getWebSocketUrl() {
    return this.cachedToken?.websocketUrl?.trim() || ""
  }

  async ensureToken(forceRefresh = false) {
    if (!forceRefresh && !shouldRefreshToken(this.cachedToken) && this.cachedToken) {
      return this.cachedToken
    }

    if (!this.canIssueToken()) {
      if (this.cachedToken && !forceRefresh) return this.cachedToken
      if (this.cachedToken) {
        throw new Error("The gaze access token expired and could not be refreshed.")
      }
      throw new Error("A GazeConnect session or token issuer configuration is required before calibration can start.")
    }

    if (this.pendingRefresh) {
      return this.pendingRefresh
    }

    const backendBaseUrl = this.config.backendBaseUrl!.trim()

    this.pendingRefresh = requestGazeAccessToken({
      backendBaseUrl,
      apiKey: this.config.apiKey?.trim(),
      deviceUuid: this.config.deviceUuid?.trim(),
    }).then((issuedToken) => {
      const nextToken: CachedAccessToken = {
        token: issuedToken.token,
        expiresAt: issuedToken.expiresAt,
        source: "issued",
        websocketUrl: issuedToken.websocketUrl,
      }
      this.cachedToken = nextToken
      return nextToken
    }).finally(() => {
      this.pendingRefresh = null
    })

    return this.pendingRefresh
  }

  async authorizedFetch(makeRequest: (token: string) => Promise<Response>) {
    const firstToken = await this.ensureToken(false)
    let response = await makeRequest(firstToken.token)
    if (response.status !== 401 && response.status !== 403) {
      return response
    }

    if (!this.canIssueToken()) {
      return response
    }

    const secondToken = await this.ensureToken(true)
    response = await makeRequest(secondToken.token)
    return response
  }
}
