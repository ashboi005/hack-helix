const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000"

function readEnv(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function getGazeCoreDemoConfig() {
  return {
    backendBaseUrl: process.env.VITE_GAZECORE_BACKEND_URL ?? DEFAULT_BACKEND_BASE_URL,
    apiKey: process.env.VITE_GAZECORE_API_KEY,
    deviceUuid: process.env.VITE_GAZECORE_DEVICE_UUID,
    email: process.env.VITE_GAZECORE_TEST_EMAIL,
    livePreviewSocketUrl: process.env.VITE_GAZECORE_LIVE_PREVIEW_WS_URL,
    livePreviewToken: process.env.VITE_GAZECORE_LIVE_PREVIEW_TOKEN,
  }
}
