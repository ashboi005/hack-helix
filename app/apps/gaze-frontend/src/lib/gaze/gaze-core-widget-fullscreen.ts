type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void
  msExitFullscreen?: () => Promise<void> | void
  webkitFullscreenElement?: Element | null
  msFullscreenElement?: Element | null
}

function hasFullscreenElement(doc: FullscreenDocument) {
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement)
}

export async function requestFullscreenSafely() {
  const doc = document as FullscreenDocument
  const root = document.documentElement as FullscreenElement
  if (hasFullscreenElement(doc)) {
    return false
  }

  const requestFullscreen = root.requestFullscreen?.bind(root)
    ?? root.webkitRequestFullscreen?.bind(root)
    ?? root.msRequestFullscreen?.bind(root)

  if (!requestFullscreen) {
    return false
  }

  try {
    await Promise.resolve(requestFullscreen())
    return hasFullscreenElement(doc)
  } catch {
    return false
  }
}

export async function exitFullscreenSafely() {
  const doc = document as FullscreenDocument
  if (!hasFullscreenElement(doc)) return

  const exitFullscreen = doc.exitFullscreen?.bind(doc)
    ?? doc.webkitExitFullscreen?.bind(doc)
    ?? doc.msExitFullscreen?.bind(doc)

  if (!exitFullscreen) return

  try {
    await Promise.resolve(exitFullscreen())
  } catch {
    // Ignore exit failures so calibration teardown can continue.
  }
}
