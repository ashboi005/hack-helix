const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000"

export function getGazeCoreDemoConfig() {
  return {
    backendBaseUrl: process.env.NEXT_PUBLIC_GAZECORE_BACKEND_URL ?? DEFAULT_BACKEND_BASE_URL,
    apiKey: process.env.NEXT_PUBLIC_GAZECORE_API_KEY,
    deviceUuid: process.env.NEXT_PUBLIC_GAZECORE_DEVICE_UUID,
    email: process.env.NEXT_PUBLIC_GAZECORE_TEST_EMAIL,
    livePreviewSocketUrl: process.env.NEXT_PUBLIC_GAZECORE_LIVE_PREVIEW_WS_URL,
    livePreviewToken: process.env.NEXT_PUBLIC_GAZECORE_LIVE_PREVIEW_TOKEN,
  }
}
