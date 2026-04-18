import { clamp, dot, norm, cross2d } from "./math"
import type { EyeCornersInput, Point, PointInput, RoiInput, RoiRect } from "./types"

export function normalizePoint(p: PointInput, label: string): Point {
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])]
  if (p && typeof p === "object") return [Number(p.x), Number(p.y)]
  throw new Error(`${label} must be [x,y] or {x,y}`)
}

export function normalizeEyeCorners(corners: EyeCornersInput): { inner: Point; outer: Point } {
  return {
    inner: normalizePoint(corners.inner, "eyeCorners.inner"),
    outer: normalizePoint(corners.outer, "eyeCorners.outer"),
  }
}

export function normalizeRoi(roi: RoiInput | undefined, width: number, height: number): RoiRect {
  if (!roi) return { x: 0, y: 0, width, height }

  if (!Array.isArray(roi) && "x" in roi) {
    return clampRoi(roi, width, height)
  }

  const corners = Array.isArray(roi)
    ? [
        normalizePoint(roi[0], "roi[0]"),
        normalizePoint(roi[1], "roi[1]"),
        normalizePoint(roi[2], "roi[2]"),
        normalizePoint(roi[3], "roi[3]"),
      ]
    : [
        normalizePoint(roi.topLeft, "roi.topLeft"),
        normalizePoint(roi.topRight, "roi.topRight"),
        normalizePoint(roi.bottomRight, "roi.bottomRight"),
        normalizePoint(roi.bottomLeft, "roi.bottomLeft"),
      ]

  const [tl, tr, br, bl] = corners
  const top = norm([tr[0] - tl[0], tr[1] - tl[1]])
  const left = norm([bl[0] - tl[0], bl[1] - tl[1]])
  const bottom = norm([br[0] - bl[0], br[1] - bl[1]])
  const right = norm([br[0] - tr[0], br[1] - tr[1]])

  const rightAngle = Math.abs(dot(top, left))
  const parallel = Math.abs(cross2d(top, bottom)) + Math.abs(cross2d(left, right))
  if (rightAngle > 0.2 || parallel > 0.4) {
    throw new Error("ROI corners must form a rectangle")
  }

  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  return clampRoi(
    {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
    width,
    height,
  )
}

function clampRoi(
  roi: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): RoiRect {
  const x = clamp(Math.round(roi.x), 0, Math.max(0, width - 1))
  const y = clamp(Math.round(roi.y), 0, Math.max(0, height - 1))
  const w = clamp(Math.round(roi.width), 1, Math.max(1, width - x))
  const h = clamp(Math.round(roi.height), 1, Math.max(1, height - y))
  return { x, y, width: w, height: h }
}
