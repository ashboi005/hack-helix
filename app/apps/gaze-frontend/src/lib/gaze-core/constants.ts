import type { Config, GazeTrackingInput } from "./types"
import { clamp, odd } from "./math"

export const PUPIL_THRESH_DEFAULT = 50
export const PUPIL_THRESH_MIN = 10
export const PUPIL_THRESH_MAX = 200
export const PUPIL_BLUR_DEFAULT = 3
export const GLINT_THRESH_DEFAULT = 240
export const GLINT_BLUR_DEFAULT = 9
export const SMOOTHING_FACTOR_DEFAULT = 0.12
export const SPHERE_RADIUS_DEFAULT = 150
export const FPS_DEFAULT = 20

export function normalizeConfig(input: GazeTrackingInput): Config {
  if (!input.cameraSource) throw new Error("cameraSource is required")
  if (!input.eyeCorners) throw new Error("eyeCorners are required")

  return {
    cameraSource: input.cameraSource,
    roi: input.roi,
    eyeCorners: input.eyeCorners,
    threshold: clamp(
      Number.isFinite(input.threshold) ? input.threshold : PUPIL_THRESH_DEFAULT,
      PUPIL_THRESH_MIN,
      PUPIL_THRESH_MAX,
    ),
    pupilBlur: odd(input.pupilBlur ?? PUPIL_BLUR_DEFAULT, 3),
    glintThreshold: clamp(input.glintThreshold ?? GLINT_THRESH_DEFAULT, 1, 255),
    glintBlur: odd(input.glintBlur ?? GLINT_BLUR_DEFAULT, 1),
    smoothingFactor: clamp(input.smoothingFactor ?? SMOOTHING_FACTOR_DEFAULT, 0.01, 0.5),
    sphereRadius: Math.max(50, input.sphereRadius ?? SPHERE_RADIUS_DEFAULT),
    fps: clamp(input.fps ?? FPS_DEFAULT, 1, 120),
    videoElement: input.videoElement,
  }
}

export function sliderToThreshold(value: number): number {
  const v = clamp(Math.round(value), PUPIL_THRESH_MIN, PUPIL_THRESH_MAX)
  return Math.round(((v - PUPIL_THRESH_MIN) / (PUPIL_THRESH_MAX - PUPIL_THRESH_MIN)) * 255)
}
