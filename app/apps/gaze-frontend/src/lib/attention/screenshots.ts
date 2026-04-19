import type { CoordinateSample, RegionImagePayload } from "./types"

export function canvasToBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL("image/png")
  return stripDataUrlPrefix(dataUrl)
}

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

export function cropRegionAtPointBase64(canvas: HTMLCanvasElement, x: number, y: number): string {
  return canvasToBase64(cropAroundPoint(canvas, x, y))
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

function clamp(value: number, min: number, max: number) {
  if (value < min) return min
  if (value > max) return max
  return value
}
