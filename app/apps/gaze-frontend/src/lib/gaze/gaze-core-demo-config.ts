const DEFAULT_APP_BACKEND_BASE_URL = "/api/backend"
const DEFAULT_GAZE_CORE_BACKEND_BASE_URL = "http://localhost:3001"

export function getGazeCoreDemoConfig() {
  const appBackendBaseUrl = DEFAULT_APP_BACKEND_BASE_URL

  return {
    appBackendBaseUrl,
    // Keep backward compatibility with existing callsites while routing auth/setup to the app backend.
    backendBaseUrl: appBackendBaseUrl,
    gazeCoreBackendBaseUrl: process.env.NEXT_PUBLIC_GAZECORE_BACKEND_URL ?? DEFAULT_GAZE_CORE_BACKEND_BASE_URL,
    apiKey: process.env.GAZE_API_KEY,
    deviceUuid: process.env.NEXT_PUBLIC_GAZECORE_DEVICE_UUID,
    email: process.env.NEXT_PUBLIC_GAZECORE_TEST_EMAIL,
    password: process.env.NEXT_PUBLIC_GAZECORE_TEST_PASSWORD,
    livePreviewSocketUrl: process.env.NEXT_PUBLIC_GAZECORE_LIVE_PREVIEW_WS_URL,
    livePreviewToken: process.env.NEXT_PUBLIC_GAZECORE_LIVE_PREVIEW_TOKEN,
  }
}
