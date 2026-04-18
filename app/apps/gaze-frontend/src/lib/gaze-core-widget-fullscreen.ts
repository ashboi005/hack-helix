export async function requestFullscreenSafely() {
  const root = document.documentElement
  if (document.fullscreenElement || !root.requestFullscreen) {
    return false
  }

  try {
    await root.requestFullscreen()
    return true
  } catch {
    return false
  }
}

export async function exitFullscreenSafely() {
  if (!document.fullscreenElement || !document.exitFullscreen) return

  try {
    await document.exitFullscreen()
  } catch {
    // Ignore exit failures so calibration teardown can continue.
  }
}
