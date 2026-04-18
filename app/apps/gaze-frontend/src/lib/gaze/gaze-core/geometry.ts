import { clamp, normalize3 } from "./math"
import type { Point, Vector3 } from "./types"

export function resolveEyeGeometry(
  corners: { inner: Point; outer: Point },
  offset: Point,
  width: number,
  height: number,
  fallbackRadius: number,
): [[number, number], number, [[number, number], [number, number]]] {
  const inner: [number, number] = [corners.inner[0] - offset[0], corners.inner[1] - offset[1]]
  const outer: [number, number] = [corners.outer[0] - offset[0], corners.outer[1] - offset[1]]

  const center: [number, number] = [(inner[0] + outer[0]) * 0.5, (inner[1] + outer[1]) * 0.5]
  let radius = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]) * 0.5
  if (!Number.isFinite(radius) || radius < 1) radius = clamp(fallbackRadius, 8, Math.min(width, height) * 0.49)
  radius = clamp(radius, 8, Math.max(width, height) * 4)

  return [center, radius, [inner, outer]]
}

export function gazeVector3D(pupil: Point, center: [number, number], radius: number): Vector3 {
  if (radius <= 1e-6) return [0, 0, 1]
  let nx = (pupil[0] - center[0]) / radius
  let ny = (pupil[1] - center[1]) / radius

  const radial = Math.hypot(nx, ny)
  if (radial >= 0.999) {
    const scale = 0.999 / Math.max(radial, 1e-6)
    nx *= scale
    ny *= scale
  }

  const nz = Math.sqrt(Math.max(1e-6, 1 - nx * nx - ny * ny))
  return normalize3([nx, ny, nz]) ?? [0, 0, 1]
}

export function driftCenter(center: [number, number], pupil: Point | null, gain: number): [number, number] {
  if (!pupil) return center
  return [
    center[0] + (pupil[0] - center[0]) * gain,
    center[1] + (pupil[1] - center[1]) * gain,
  ]
}
