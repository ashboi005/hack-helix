const DEFAULT_BACKEND_BASE_URL = "/api/backend"

export function normalizeBackendBaseUrl(baseUrl?: string) {
  const normalized = (baseUrl?.trim() || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/g, "")
  return normalized || DEFAULT_BACKEND_BASE_URL
}

function buildRouteUrl(baseUrl: string | undefined, routePath: string) {
  const normalizedBaseUrl = normalizeBackendBaseUrl(baseUrl)

  if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
    const base = normalizedBaseUrl.replace(/\/+$/g, "")
    const suffix = routePath.startsWith("/") ? routePath : `/${routePath}`
    return `${base}${suffix}`
  }

  const url = new URL(routePath, `${normalizedBaseUrl}/`)
  return url.toString()
}

export function buildTokenRouteUrl(baseUrl?: string) {
  return buildRouteUrl(baseUrl, "/eye/token")
}

export function buildGyroSnapshotRouteUrl(baseUrl?: string) {
  return buildRouteUrl(baseUrl, "/eye/calibration/phase-zero-settle")
}

export function buildPhaseZeroSettleRouteUrl(baseUrl?: string) {
  return buildRouteUrl(baseUrl, "/eye/calibration/phase-zero-settle")
}

export function buildCalibrationRecordStartRouteUrl(baseUrl?: string) {
  return buildRouteUrl(baseUrl, "/eye/calibration/record/start")
}

export function buildCalibrationRecordCompleteRouteUrl(baseUrl?: string) {
  return buildRouteUrl(baseUrl, "/eye/calibration/record/complete")
}

export function buildLivePreviewSocketUrl(baseUrl?: string, overrideSocketUrl?: string) {
  if (overrideSocketUrl?.trim()) return overrideSocketUrl.trim()

  const normalizedBaseUrl = normalizeBackendBaseUrl(baseUrl)

  if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
    // Relative base URL — resolve against the current page origin so that
    // HTTPS pages automatically get wss:// and HTTP pages get ws://.
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
    const httpUrl = new URL(`/api/gaze/screen/ws`, origin)
    httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:"
    return httpUrl.toString()
  }

  const url = new URL("/api/gaze/screen/ws", `${normalizedBaseUrl}/`)
  // Upgrade ws/wss to match the security level of the current page: if the
  // page is on HTTPS always use wss:// regardless of what the backend URL says.
  const pageIsHttps = typeof window !== "undefined" && window.location.protocol === "https:"
  if (pageIsHttps) {
    url.protocol = "wss:"
  } else {
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  }
  return url.toString()
}
