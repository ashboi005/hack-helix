import type { CameraSource } from "./types"

export async function usbConstraints(
  src: Extract<CameraSource, { kind: "usb" }>,
): Promise<MediaTrackConstraints> {
  const base = { ...(src.constraints ?? {}) } as MediaTrackConstraints
  if (src.source === undefined || src.source === null || src.source === "") return base

  if (typeof src.source === "string" && Number.isNaN(Number(src.source))) {
    return { ...base, deviceId: { exact: src.source } }
  }

  const idx = Number(src.source)
  if (!Number.isInteger(idx) || idx < 0) return base

  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput")
    if (!devices[idx]?.deviceId) return base
    return { ...base, deviceId: { exact: devices[idx].deviceId } }
  } catch {
    return base
  }
}

export async function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return

  await new Promise<void>((resolve, reject) => {
    const ok = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup()
        resolve()
      }
    }
    const fail = () => {
      cleanup()
      reject(new Error("Unable to load video source"))
    }
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", ok)
      video.removeEventListener("canplay", ok)
      video.removeEventListener("error", fail)
    }

    video.addEventListener("loadedmetadata", ok)
    video.addEventListener("canplay", ok)
    video.addEventListener("error", fail)
  })
}
