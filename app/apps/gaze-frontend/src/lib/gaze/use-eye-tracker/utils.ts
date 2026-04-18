import type { GazeVectorReturn } from "@/lib/gaze-core"
import type { ModeVectorPoint, PreviewGazeData, RoiRect } from "./types"

export function buildCalibrationGrid(screenWidth: number, screenHeight: number): [number, number][] {
  return [
    [0, 0],
    [screenWidth / 2, 0],
    [screenWidth, 0],
    [screenWidth, screenHeight / 2],
    [screenWidth, screenHeight],
    [screenWidth / 2, screenHeight],
    [0, screenHeight],
    [0, screenHeight / 2],
    [screenWidth / 2, screenHeight / 2],
  ]
}

export function clampValue(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value))
}

export function normalizeGazeVector(
  raw: [number, number, number] | null | undefined,
): [number, number, number] | null {
  if (!raw || raw.length !== 3) return null
  const [x, y, z] = raw
  const magnitude = Math.hypot(x, y, z)
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) return null
  return [x / magnitude, y / magnitude, z / magnitude]
}

export function toPreviewGazeData(result: GazeVectorReturn | null): PreviewGazeData | null {
  if (!result) return null
  return {
    pupil_center: result.iPupilDetectionReturn.pupilCenter ?? undefined,
    pupil_ellipse: result.pupilSphereEllipse
      ? {
        center: result.pupilSphereEllipse.center,
        axes: result.pupilSphereEllipse.axes,
        angle: result.pupilSphereEllipse.angle,
      }
      : undefined,
    screen_position: result.screenPosition ?? undefined,
    gaze_vector: result.gazeVector,
    eye_model: result.eyeModel,
    pupil_score: result.iPupilDetectionReturn.score ?? undefined,
  }
}

export function modeVector(samples: [number, number, number][]): [number, number, number] | null {
  if (samples.length === 0) return null

  const buckets = new Map<string, ModeVectorPoint>()
  for (const sample of samples) {
    const normalized = normalizeGazeVector(sample)
    if (!normalized) continue
    const key = normalized.map((value) => value.toFixed(3)).join(",")
    const existing = buckets.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    buckets.set(key, { key, vector: normalized, count: 1 })
  }

  let best: ModeVectorPoint | null = null
  for (const point of buckets.values()) {
    if (!best || point.count > best.count) best = point
  }
  return best?.vector ?? null
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.drawImage(video, 0, 0, width, height, 0, 0, ctx.canvas.width, ctx.canvas.height)
}

export function drawRoiOverlay(
  ctx: CanvasRenderingContext2D,
  roi: RoiRect,
  scaleX: number,
  scaleY: number,
  activeHandle: number,
): void {
  const rx = roi.x * scaleX
  const ry = roi.y * scaleY
  const rw = roi.width * scaleX
  const rh = roi.height * scaleY

  ctx.fillStyle = "rgba(0,0,0,0.45)"
  ctx.fillRect(0, 0, ctx.canvas.width, ry)
  ctx.fillRect(0, ry + rh, ctx.canvas.width, ctx.canvas.height - ry - rh)
  ctx.fillRect(0, ry, rx, rh)
  ctx.fillRect(rx + rw, ry, ctx.canvas.width - rx - rw, rh)

  ctx.strokeStyle = "#3b82f6"
  ctx.lineWidth = 2
  ctx.strokeRect(rx, ry, rw, rh)

  const corners: [number, number][] = [
    [rx, ry],
    [rx + rw, ry],
    [rx, ry + rh],
    [rx + rw, ry + rh],
  ]

  corners.forEach(([cx, cy], i) => {
    ctx.beginPath()
    ctx.arc(cx, cy, 10, 0, Math.PI * 2)
    ctx.fillStyle = i === activeHandle ? "#60a5fa" : "#ffffff"
    ctx.fill()
    ctx.strokeStyle = "#3b82f6"
    ctx.lineWidth = 2
    ctx.stroke()
  })
}

export function drawEyeCornerSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  corners: { inner: [number, number] | null; outer: [number, number] | null },
  activeTarget: "inner" | "outer",
  scaleX: number,
  scaleY: number,
): void {
  const drawCorner = (
    point: [number, number] | null,
    label: string,
    color: string,
    isActive: boolean,
  ) => {
    if (!point) return
    const x = point[0] * scaleX
    const y = point[1] * scaleY

    ctx.beginPath()
    ctx.arc(x, y, isActive ? 7 : 5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.font = "12px monospace"
    ctx.fillStyle = "#f8fafc"
    ctx.fillText(label, x + 9, y - 9)
  }

  drawCorner(corners.inner, "Inner", "#f59e0b", activeTarget === "inner")
  drawCorner(corners.outer, "Outer", "#22d3ee", activeTarget === "outer")

  if (corners.inner && corners.outer) {
    const ix = corners.inner[0] * scaleX
    const iy = corners.inner[1] * scaleY
    const ox = corners.outer[0] * scaleX
    const oy = corners.outer[1] * scaleY
    const mx = (ix + ox) * 0.5
    const my = (iy + oy) * 0.5

    ctx.strokeStyle = "rgba(250, 204, 21, 0.9)"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ix, iy)
    ctx.lineTo(ox, oy)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(mx, my, 4, 0, Math.PI * 2)
    ctx.fillStyle = "#eab308"
    ctx.fill()
  }
}

export function drawEyeModelOverlay(
  ctx: CanvasRenderingContext2D,
  gazeData: PreviewGazeData,
  scaleX: number,
  scaleY: number,
  roiOffset: RoiRect | null,
): void {
  const model = gazeData.eye_model
  if (!model) return

  if (model.corners) {
    const ix = model.corners.inner[0] * scaleX
    const iy = model.corners.inner[1] * scaleY
    const ox = model.corners.outer[0] * scaleX
    const oy = model.corners.outer[1] * scaleY

    ctx.beginPath()
    ctx.moveTo(ix, iy)
    ctx.lineTo(ox, oy)
    ctx.strokeStyle = "rgba(250, 204, 21, 0.75)"
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(ix, iy, 4, 0, Math.PI * 2)
    ctx.fillStyle = "#f59e0b"
    ctx.fill()

    ctx.beginPath()
    ctx.arc(ox, oy, 4, 0, Math.PI * 2)
    ctx.fillStyle = "#22d3ee"
    ctx.fill()
  }

  if (model.center && typeof model.radius === "number" && Number.isFinite(model.radius)) {
    const cx = model.center[0] * scaleX
    const cy = model.center[1] * scaleY
    const radius = model.radius * ((scaleX + scaleY) * 0.5)
    const outerRadius = Math.max(6, radius)
    const minorRadius = Math.max(4, outerRadius * 0.38)

    ctx.beginPath()
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(59, 130, 246, 0.8)"
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.beginPath()
    ctx.ellipse(cx, cy, minorRadius, outerRadius, 0, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(34, 197, 94, 0.75)"
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.beginPath()
    ctx.ellipse(cx, cy, outerRadius, minorRadius, 0, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(234, 179, 8, 0.75)"
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  if (model.dynamic_center) {
    const dx = model.dynamic_center[0] * scaleX
    const dy = model.dynamic_center[1] * scaleY
    ctx.beginPath()
    ctx.arc(dx, dy, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = "#38bdf8"
    ctx.fill()

    const target = gazeData.screen_position
      ? ([gazeData.screen_position[0], gazeData.screen_position[1]] as const)
      : gazeData.pupil_center
        ? ([gazeData.pupil_center[0] + (roiOffset?.x ?? 0), gazeData.pupil_center[1] + (roiOffset?.y ?? 0)] as const)
        : null

    if (target) {
      ctx.beginPath()
      ctx.moveTo(dx, dy)
      ctx.lineTo(target[0] * scaleX, target[1] * scaleY)
      ctx.strokeStyle = "rgba(14, 165, 233, 0.7)"
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

export function drawGazeOverlay(
  ctx: CanvasRenderingContext2D,
  gazeData: PreviewGazeData,
  scaleX: number,
  scaleY: number,
  roiOffset: RoiRect | null,
): void {
  const [px, py] = gazeData.pupil_center ?? [0, 0]
  const offsetX = roiOffset?.x ?? 0
  const offsetY = roiOffset?.y ?? 0

  const centerSource = gazeData.screen_position
    ? ([gazeData.screen_position[0], gazeData.screen_position[1]] as const)
    : ([px + offsetX, py + offsetY] as const)

  const cx = centerSource[0] * scaleX
  const cy = centerSource[1] * scaleY

  if (gazeData.pupil_ellipse) {
    const { center, axes, angle } = gazeData.pupil_ellipse
    const ex = center[0] * scaleX
    const ey = center[1] * scaleY

    ctx.save()
    ctx.translate(ex, ey)
    ctx.rotate((angle * Math.PI) / 180)
    ctx.beginPath()
    ctx.ellipse(0, 0, axes[0] * scaleX, axes[1] * scaleY, 0, 0, Math.PI * 2)
    ctx.strokeStyle = "#39d98a"
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  if (!gazeData.pupil_center && !gazeData.screen_position) return
  ctx.beginPath()
  ctx.arc(cx, cy, 4, 0, Math.PI * 2)
  ctx.fillStyle = "#39d98a"
  ctx.fill()
}

export function drawThresholdMask(
  ctx: CanvasRenderingContext2D,
  mask: { width: number; height: number; data: Uint8Array } | null,
  frameWidth: number,
  frameHeight: number,
  roi: RoiRect | null,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = "#050a12"
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (!mask || !roi) return

  const maskImage = ctx.createImageData(mask.width, mask.height)
  for (let i = 0; i < mask.data.length; i += 1) {
    const value = mask.data[i]
    const p = i * 4
    maskImage.data[p] = value
    maskImage.data[p + 1] = value
    maskImage.data[p + 2] = value
    maskImage.data[p + 3] = 255
  }

  const offscreen = document.createElement("canvas")
  offscreen.width = mask.width
  offscreen.height = mask.height
  const offscreenCtx = offscreen.getContext("2d")
  if (!offscreenCtx) return
  offscreenCtx.putImageData(maskImage, 0, 0)

  const sx = ctx.canvas.width / frameWidth
  const sy = ctx.canvas.height / frameHeight
  const dx = roi.x * sx
  const dy = roi.y * sy
  const dw = roi.width * sx
  const dh = roi.height * sy

  ctx.drawImage(offscreen, dx, dy, dw, dh)
  ctx.strokeStyle = "rgba(96, 165, 250, 0.9)"
  ctx.lineWidth = 1.5
  ctx.strokeRect(dx, dy, dw, dh)
}
