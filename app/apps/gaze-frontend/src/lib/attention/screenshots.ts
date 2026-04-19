import type { CoordinateSample, RegionImagePayload } from "./types"

export function canvasToBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL("image/png")
  return stripDataUrlPrefix(dataUrl)
}

/**
 * Build region screenshots by picking the top-N highest-deflection points
 * from the coordinate history and cropping around them.
 */
export function buildRegionScreenshots(
  canvas: HTMLCanvasElement,
  coordinates: CoordinateSample[],
  targetPageNumber: number,
  count = 5,
): RegionImagePayload[] {
  if (!coordinates.length) return []

  const clusters = pickDeflectionClusters(coordinates, count)

  return clusters.map(({ x, y }) => {
    const crop = cropAroundPoint(canvas, x, y)
    return {
      imageBase64: canvasToBase64(crop),
      pageNumber: targetPageNumber,
    }
  })
}

/**
 * Build screenshots specifically for erratic gaze jumps.
 *
 * For each of the largest jumps we capture TWO crops:
 *   1. The "from" point (where the gaze was before the jump)
 *   2. The "to"   point (where the gaze landed after the jump)
 *
 * This gives the backend both sides of the context so it can judge whether
 * the person was genuinely referencing another part of the page or drifting.
 *
 * Returns up to `maxJumps * 2` region images (default 4 = 2 jumps × 2 sides).
 */
export function buildErraticJumpScreenshots(
  canvas: HTMLCanvasElement,
  coordinates: CoordinateSample[],
  targetPageNumber: number,
  maxJumps = 2,
): RegionImagePayload[] {
  if (coordinates.length < 2) return []

  // Score each consecutive pair by jump distance
  const jumps: Array<{ from: CoordinateSample; to: CoordinateSample; dist: number }> = []

  for (let i = 1; i < coordinates.length; i += 1) {
    const from = coordinates[i - 1]
    const to = coordinates[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > 30) {
      // Only consider actual big jumps
      jumps.push({ from, to, dist })
    }
  }

  // Sort by largest distance first
  jumps.sort((a, b) => b.dist - a.dist)

  // Deduplicate — skip jumps whose endpoints are too close to already-picked ones
  const picked: Array<{ from: CoordinateSample; to: CoordinateSample }> = []
  for (const jump of jumps) {
    if (picked.length >= maxJumps) break

    const tooClose = picked.some(
      (existing) =>
        Math.hypot(existing.from.x - jump.from.x, existing.from.y - jump.from.y) < 60 ||
        Math.hypot(existing.to.x - jump.to.x, existing.to.y - jump.to.y) < 60,
    )
    if (!tooClose) {
      picked.push({ from: jump.from, to: jump.to })
    }
  }

  // Build region images: from-crop, then to-crop for each jump
  const regions: RegionImagePayload[] = []
  for (const jump of picked) {
    const fromCrop = cropAroundPoint(canvas, jump.from.x, jump.from.y)
    regions.push({
      imageBase64: canvasToBase64(fromCrop),
      pageNumber: jump.from.pageNumber ?? targetPageNumber,
    })

    const toCrop = cropAroundPoint(canvas, jump.to.x, jump.to.y)
    regions.push({
      imageBase64: canvasToBase64(toCrop),
      pageNumber: jump.to.pageNumber ?? targetPageNumber,
    })
  }

  return regions
}

export function cropRegionAtPointBase64(canvas: HTMLCanvasElement, x: number, y: number): string {
  return canvasToBase64(cropAroundPoint(canvas, x, y))
}

export function cropLineAtPointBase64(canvas: HTMLCanvasElement, x: number, y: number): string {
  return canvasToBase64(cropLineAroundPoint(canvas, x, y))
}

export function renderGazeMarkedPageBase64(canvas: HTMLCanvasElement, x: number, y: number): string {
  const marked = document.createElement("canvas")
  marked.width = canvas.width
  marked.height = canvas.height

  const ctx = marked.getContext("2d")
  if (!ctx) return canvasToBase64(canvas)

  const gx = clamp(Math.round(x), 0, Math.max(0, canvas.width - 1))
  const gy = clamp(Math.round(y), 0, Math.max(0, canvas.height - 1))
  const bandHeight = Math.min(64, canvas.height)
  const top = clamp(Math.round(gy - bandHeight / 2), 0, Math.max(0, canvas.height - bandHeight))

  ctx.drawImage(canvas, 0, 0)

  ctx.fillStyle = "rgba(34, 211, 238, 0.16)"
  ctx.fillRect(0, top, canvas.width, bandHeight)

  ctx.strokeStyle = "rgba(34, 211, 238, 0.88)"
  ctx.lineWidth = 2
  ctx.strokeRect(0, top, canvas.width, bandHeight)

  ctx.beginPath()
  ctx.arc(gx, gy, 7, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(34, 211, 238, 0.95)"
  ctx.fill()

  ctx.beginPath()
  ctx.arc(gx, gy, 15, 0, Math.PI * 2)
  ctx.strokeStyle = "rgba(34, 211, 238, 0.55)"
  ctx.lineWidth = 3
  ctx.stroke()

  return canvasToBase64(marked)
}

function stripDataUrlPrefix(dataUrl: string): string {
  const marker = ","
  const index = dataUrl.indexOf(marker)
  return index >= 0 ? dataUrl.slice(index + 1) : dataUrl
}

function pickDeflectionClusters(samples: CoordinateSample[], count: number): Array<{ x: number; y: number }> {
  const scored: Array<{ x: number; y: number; score: number }> = []

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]
    const curr = samples[i]
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    const score = Math.abs(dx) + Math.abs(dy)
    scored.push({ x: curr.x, y: curr.y, score })
  }

  scored.sort((a, b) => b.score - a.score)

  const picked: Array<{ x: number; y: number }> = []
  for (const item of scored) {
    const tooClose = picked.some((other) => Math.hypot(other.x - item.x, other.y - item.y) < 70)
    if (!tooClose) {
      picked.push({ x: item.x, y: item.y })
    }
    if (picked.length >= count) break
  }

  if (picked.length < count) {
    for (const sample of samples) {
      if (picked.length >= count) break
      picked.push({ x: sample.x, y: sample.y })
    }
  }

  return picked.slice(0, count)
}

function cropAroundPoint(canvas: HTMLCanvasElement, x: number, y: number): HTMLCanvasElement {
  const side = 220
  const sx = clamp(Math.round(x - side / 2), 0, Math.max(0, canvas.width - side))
  const sy = clamp(Math.round(y - side / 2), 0, Math.max(0, canvas.height - side))
  const width = Math.min(side, canvas.width)
  const height = Math.min(side, canvas.height)

  const offscreen = document.createElement("canvas")
  offscreen.width = width
  offscreen.height = height

  const ctx = offscreen.getContext("2d")
  if (!ctx) return offscreen

  ctx.drawImage(canvas, sx, sy, width, height, 0, 0, width, height)

  return offscreen
}

function cropLineAroundPoint(canvas: HTMLCanvasElement, x: number, y: number): HTMLCanvasElement {
  const bandHeight = Math.min(72, canvas.height)
  const sx = 0
  const sy = clamp(Math.round(y - bandHeight / 2), 0, Math.max(0, canvas.height - bandHeight))
  const width = canvas.width
  const height = bandHeight

  const offscreen = document.createElement("canvas")
  offscreen.width = width
  offscreen.height = height

  const ctx = offscreen.getContext("2d")
  if (!ctx) return offscreen

  ctx.drawImage(canvas, sx, sy, width, height, 0, 0, width, height)

  const relativeX = clamp(Math.round(x), 0, Math.max(0, width - 1))
  ctx.strokeStyle = "rgba(34, 211, 238, 0.9)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(relativeX, 0)
  ctx.lineTo(relativeX, height)
  ctx.stroke()

  return offscreen
}

function clamp(value: number, min: number, max: number) {
  if (value < min) return min
  if (value > max) return max
  return value
}
