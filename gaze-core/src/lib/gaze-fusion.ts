import type { CalibrationPayload, SolvedGazePoint, Vector3 } from "./gaze-types"
import type { Point2D, SolveGazePointInput } from "../types/gaze-fusion"

function clamp(value: number, minValue: number, maxValue: number) {
  return Math.max(minValue, Math.min(maxValue, value))
}

function normalizeVector(vector: Vector3 | null | undefined): Vector3 | null {
  if (!vector || vector.length !== 3) return null

  const [x, y, z] = vector
  const magnitude = Math.hypot(x, y, z)
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) return null

  return [x / magnitude, y / magnitude, z / magnitude]
}

function angleBetweenVectors(a: Vector3, b: Vector3): number {
  const na = normalizeVector(a)
  const nb = normalizeVector(b)
  if (!na || !nb) return 180

  const dot = clamp(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2], -1, 1)
  return (Math.acos(dot) * 180) / Math.PI
}



function solveBasePoint(
  calibration: CalibrationPayload,
  gazeVector: Vector3,
) {
  const normalizedGaze = normalizeVector(gazeVector)
  if (!normalizedGaze || calibration.points.length === 0) return null

  const ranked = calibration.points
    .map((point) => ({
      point,
      angle: angleBetweenVectors(gazeVector, point.gaze),
    }))
    .sort((a, b) => a.angle - b.angle)
    .slice(0, 6)

  if (ranked.length === 0) return null

  let totalWeight = 0
  let weightedX = 0
  let weightedY = 0
  let weightedAngle = 0

  for (const candidate of ranked) {
    const weight = 1 / Math.max(candidate.angle + 1, 0.5) ** 1.5
    totalWeight += weight
    weightedX += candidate.point.screen[0] * weight
    weightedY += candidate.point.screen[1] * weight
    weightedAngle += candidate.angle * weight
  }

  if (totalWeight <= 0) return null

  const averageAngle = weightedAngle / totalWeight
  const confidence = clamp(1 - averageAngle / 40, 0.05, 1)

  return {
    point: {
      x: weightedX / totalWeight,
      y: weightedY / totalWeight,
    },
    confidence,
  }
}

function smoothPoint(
  previousPoint: Point2D | null | undefined,
  nextPoint: Point2D,
  calibration: CalibrationPayload,
) {
  if (!previousPoint) return nextPoint

  const diagonal = Math.hypot(calibration.screen.width, calibration.screen.height) || 1
  const jumpRatio = Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y) / diagonal
  const alpha = jumpRatio > 0.25 ? 0.12 : jumpRatio > 0.1 ? 0.2 : 0.32

  return {
    x: previousPoint.x + (nextPoint.x - previousPoint.x) * alpha,
    y: previousPoint.y + (nextPoint.y - previousPoint.y) * alpha,
  }
}

export function solveGazePoint(input: SolveGazePointInput): SolvedGazePoint | null {
  const base = solveBasePoint(input.calibration, input.gazeVector)
  if (!base) return null

  const clamped: Point2D = {
    x: clamp(base.point.x, 0, input.calibration.screen.width),
    y: clamp(base.point.y, 0, input.calibration.screen.height),
  }
  const smoothed = smoothPoint(input.previousPoint, clamped, input.calibration)

  return {
    x: smoothed.x,
    y: smoothed.y,
    timestamp: Date.now(),
    confidence: base.confidence,
    basePoint: base.point,
    gyroDelta: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 },
    compensatedGazeVector: input.gazeVector,
    motionKind: "legacy-gyro",
  }
}
