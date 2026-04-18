import { PUPIL_THRESH_MIN, sliderToThreshold } from "./constants"
import { clamp } from "./math"
import {
  adaptiveInv,
  and,
  componentMean,
  components,
  count,
  gaussian,
  percentile,
} from "./image"
import type { Component, Detection, Ellipse, Point } from "./types"

export function detectPupil(
  gray: Uint8Array,
  width: number,
  height: number,
  center: Point,
  blurSize: number,
  threshold: number,
): Detection {
  const blur = gaussian(gray, width, height, blurSize)
  const mappedThreshold = sliderToThreshold(threshold)

  const binary = new Uint8Array(blur.length)
  for (let i = 0; i < blur.length; i += 1) {
    binary[i] = blur[i] > mappedThreshold ? 0 : 255
  }

  const darkCutoff = percentile(blur, 0.18)
  const dark = new Uint8Array(blur.length)
  for (let i = 0; i < blur.length; i += 1) dark[i] = blur[i] <= darkCutoff ? 255 : 0

  const adaptiveBlock = Math.max(11, blurSize * 5)
  const adaptiveC = clamp(Math.floor(threshold * 0.2), 2, 12)
  const adaptive = adaptiveInv(blur, width, height, adaptiveBlock, adaptiveC)

  let mask = threshold <= PUPIL_THRESH_MIN ? dark.slice() : and(binary, dark)
  if (count(mask) < Math.max(8, Math.floor(width * height * 0.00008))) {
    mask = and(adaptive, dark)
  }
  if (count(mask) < Math.max(8, Math.floor(width * height * 0.00008))) {
    mask = dark.slice()
  }

  mask = closeMask(mask, width, height, 1)

  const candidates = components(mask, width, height)
  const minArea = Math.max(24, Math.floor(width * height * 0.00025))
  const maxArea = Math.max(minArea + 1, Math.floor(width * height * 0.08))
  const targetArea = Math.max(minArea, Math.floor(width * height * 0.014))

  let best: Component | null = null
  let bestScore = -1

  for (const c of candidates) {
    if (c.area < minArea || c.area > maxArea || c.perimeter <= 0) continue

    const circularity = clamp((4 * Math.PI * c.area) / (c.perimeter * c.perimeter), 0, 1)
    const aspect = clamp(Math.min(c.bbox.width, c.bbox.height) / Math.max(c.bbox.width, c.bbox.height), 0, 1)
    if (aspect < 0.25) continue

    const fill = clamp(c.area / (c.bbox.width * c.bbox.height), 0, 1)
    const darkness = clamp(1 - componentMean(c, gray, width) / 255, 0, 1)

    const cx = c.bbox.x + c.bbox.width / 2
    const cy = c.bbox.y + c.bbox.height / 2
    const distance = Math.hypot(cx - center[0], cy - center[1])
    const distanceScore = 1 - clamp(distance / Math.max(1, Math.min(width, height) * 0.45), 0, 1)
    const areaScore = clamp(c.area / Math.max(1, targetArea), 0, 1.5) / 1.5
    const edge = Math.min(c.bbox.x, c.bbox.y, width - (c.bbox.x + c.bbox.width), height - (c.bbox.y + c.bbox.height))
    const edgeScore = clamp(edge / Math.max(1, Math.min(width, height) * 0.2), 0, 1)
    const centerBonus = c.area > 0 ? clamp(1 - Math.hypot(cx - center[0], cy - center[1]) / Math.max(1, Math.min(width, height) * 0.5), 0, 1) : 0

    const score =
      circularity * 0.14
      + darkness * 0.26
      + fill * 0.08
      + aspect * 0.05
      + areaScore * 0.28
      + distanceScore * 0.11
      + edgeScore * 0.03
      + centerBonus * 0.05

    const bboxArea = c.bbox.width * c.bbox.height
    if (bboxArea > 0 && c.area / bboxArea < 0.2) continue

    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }

  const ellipseSource = resolveEllipseSource(best, mask, dark, width, height, center, minArea)

  if (!best) {
    if (ellipseSource) {
      const pupilMask = componentToMask(ellipseSource, width, height)
      const pupilEllipse = fitEllipse(ellipseSource, width, height)
      const pupilCenter: Point = [
        Math.round(pupilEllipse.center[0]),
        Math.round(pupilEllipse.center[1]),
      ]
      return {
        pupilCenter,
        pupilEllipse,
        pupilMask,
        thresholdPreview: mask.slice(),
        score: 0,
      }
    }
    return {
      pupilCenter: null,
      pupilEllipse: null,
      pupilMask: mask.slice(),
      thresholdPreview: mask.slice(),
      score: -1,
    }
  }

  const pupilMask = componentToMask(best, width, height)
  const fitted = fitEllipse(ellipseSource ?? best, width, height)
  const pupilCenter: Point = [
    Math.round(fitted.center[0]),
    Math.round(fitted.center[1]),
  ]

  return {
    pupilCenter,
    pupilEllipse: fitted,
    pupilMask,
    thresholdPreview: mask.slice(),
    score: bestScore,
  }
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = false
      for (let dy = -1; dy <= 1 && !on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = x + dx
          const py = y + dy
          if (px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px] > 0) {
            on = true
            break
          }
        }
      }
      out[y * width + x] = on ? 255 : 0
    }
  }
  return out
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = true
      for (let dy = -1; dy <= 1 && on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = x + dx
          const py = y + dy
          if (px < 0 || py < 0 || px >= width || py >= height || mask[py * width + px] === 0) {
            on = false
            break
          }
        }
      }
      out[y * width + x] = on ? 255 : 0
    }
  }
  return out
}

function componentOverlapRatio(a: Component, b: Component, width: number, height: number): number {
  const map = new Uint8Array(width * height)
  for (let i = 0; i < b.points.length; i += 2) {
    map[b.points[i + 1] * width + b.points[i]] = 1
  }

  let overlap = 0
  for (let i = 0; i < a.points.length; i += 2) {
    if (map[a.points[i + 1] * width + a.points[i]]) overlap += 1
  }

  return overlap / Math.max(1, Math.min(a.area, b.area))
}

function closeMask(mask: Uint8Array, width: number, height: number, passes: number): Uint8Array {
  let out: Uint8Array = new Uint8Array(mask.length)
  out.set(mask)
  for (let i = 0; i < passes; i += 1) out = dilate(out, width, height)
  for (let i = 0; i < passes; i += 1) out = erode(out, width, height)
  return out
}

function componentToMask(component: Component, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let i = 0; i < component.points.length; i += 2) {
    out[component.points[i + 1] * width + component.points[i]] = 255
  }
  return out
}

function resolveEllipseSource(
  best: Component | null,
  mask: Uint8Array,
  dark: Uint8Array,
  width: number,
  height: number,
  center: Point,
  minArea: number,
): Component | null {
  const searchMask = best ? and(componentToMask(best, width, height), dark) : and(mask, dark)
  const mergedMask = closeMask(searchMask, width, height, 2)
  const blobs = components(mergedMask, width, height)

  let selected: Component | null = null
  let selectedScore = -1
  for (const blob of blobs) {
    if (blob.area < Math.max(6, Math.floor(minArea * 0.25))) continue

    const cx = blob.bbox.x + blob.bbox.width * 0.5
    const cy = blob.bbox.y + blob.bbox.height * 0.5
    const distance = Math.hypot(cx - center[0], cy - center[1])
    const distanceScore = 1 - clamp(distance / Math.max(1, Math.min(width, height) * 0.5), 0, 1)
    const overlapScore = best ? componentOverlapRatio(blob, best, width, height) : 1
    const score = blob.area * (0.75 + distanceScore * 0.15 + overlapScore * 0.1)

    if (score > selectedScore) {
      selectedScore = score
      selected = blob
    }
  }

  return selected
}

export function detectGlint(
  gray: Uint8Array,
  width: number,
  height: number,
  blurSize: number,
  threshold: number,
): Point | null {
  const blur = gaussian(gray, width, height, blurSize)
  const mask = new Uint8Array(blur.length)
  for (let i = 0; i < blur.length; i += 1) {
    mask[i] = blur[i] > threshold ? 255 : 0
  }

  const glints = components(mask, width, height)
  for (const g of glints) {
    if (g.area > 2) {
      return [Math.round(g.sumX / g.area), Math.round(g.sumY / g.area)]
    }
  }
  return null
}

function fitEllipse(component: Component, width: number, height: number): Ellipse {
  if (component.points.length < 10) {
    const radius = Math.max(3, Math.sqrt(Math.max(1, component.area) / Math.PI))
    return {
      center: [
        component.bbox.x + component.bbox.width * 0.5,
        component.bbox.y + component.bbox.height * 0.5,
      ],
      axes: [radius, radius],
      angle: 0,
    }
  }

  const blobMask = componentToMask(component, width, height)
  const boundary = extractBoundaryPoints(component, blobMask, width, height)
  const hull = convexHull(boundary)
  const seedCenter: Point = [
    component.bbox.x + component.bbox.width * 0.5,
    component.bbox.y + component.bbox.height * 0.5,
  ]
  const fitted = fitCircleLeastSquares(hull)
  const center: Point = fitted?.center ?? seedCenter
  const distances = hull.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1]))
  const edgeRadius = percentileNumber(distances, 0.72)
  const areaRadius = Math.sqrt(Math.max(1, component.area) / Math.PI)
  const bboxRadius = Math.max(3, Math.min(component.bbox.width, component.bbox.height) * 0.5)
  const radius = clamp(
    Math.max(edgeRadius, fitted?.radius ?? 0, areaRadius * 0.95),
    3,
    bboxRadius,
  )

  return {
    center,
    axes: [radius, radius],
    angle: 0,
  }
}

function extractBoundaryPoints(
  component: Component,
  mask: Uint8Array,
  width: number,
  height: number,
): Point[] {
  const boundary: Point[] = []
  for (let i = 0; i < component.points.length; i += 2) {
    const x = component.points[i]
    const y = component.points[i + 1]
    const neighbors: Point[] = [[0, -1], [1, 0], [0, 1], [-1, 0]]
    for (const [dx, dy] of neighbors) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny * width + nx] === 0) {
        boundary.push([x, y])
        break
      }
    }
  }
  return boundary.length > 0 ? boundary : [[component.sumX / component.area, component.sumY / component.area]]
}

function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points

  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]))
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const lower: Point[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function fitCircleLeastSquares(points: Point[]): { center: Point; radius: number } | null {
  if (points.length < 3) return null

  let sumX = 0
  let sumY = 0
  let sumX2 = 0
  let sumY2 = 0
  let sumXY = 0
  let sumXS = 0
  let sumYS = 0
  let sumS = 0

  for (const [x, y] of points) {
    const s = x * x + y * y
    sumX += x
    sumY += y
    sumX2 += x * x
    sumY2 += y * y
    sumXY += x * y
    sumXS += x * s
    sumYS += y * s
    sumS += s
  }

  const matrix = [
    [sumX2, sumXY, sumX, -sumXS],
    [sumXY, sumY2, sumY, -sumYS],
    [sumX, sumY, points.length, -sumS],
  ]

  const solved = solve3x3(matrix)
  if (!solved) return null

  const [a, b, c] = solved
  const center: Point = [-a / 2, -b / 2]
  const radiusSq = center[0] * center[0] + center[1] * center[1] - c
  if (!Number.isFinite(radiusSq) || radiusSq <= 0) return null

  return {
    center,
    radius: Math.sqrt(radiusSq),
  }
}

function solve3x3(matrix: number[][]): [number, number, number] | null {
  const m = matrix.map((row) => row.slice())

  for (let col = 0; col < 3; col += 1) {
    let pivot = col
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-8) return null
    if (pivot !== col) [m[col], m[pivot]] = [m[pivot], m[col]]

    const divisor = m[col][col]
    for (let k = col; k < 4; k += 1) m[col][k] /= divisor

    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue
      const factor = m[row][col]
      for (let k = col; k < 4; k += 1) m[row][k] -= factor * m[col][k]
    }
  }

  return [m[0][3], m[1][3], m[2][3]]
}

function percentileNumber(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.round((sorted.length - 1) * q), 0, sorted.length - 1)
  return sorted[index]
}
