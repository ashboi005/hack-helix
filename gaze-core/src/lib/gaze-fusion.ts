import { gazeConfig } from "./gaze-config"
import type { CalibrationPayload, GyroReading, SolvedGazePoint, Vector3 } from "./gaze-types"
import type { GyroScale, Point2D, SolveGazePointInput } from "../types/gaze-fusion"

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

function averageVectors(vectors: Vector3[]) {
  if (vectors.length === 0) return null

  let sumX = 0
  let sumY = 0
  let sumZ = 0

  for (const vector of vectors) {
    const normalized = normalizeVector(vector)
    if (!normalized) continue

    sumX += normalized[0]
    sumY += normalized[1]
    sumZ += normalized[2]
  }

  return normalizeVector([sumX, sumY, sumZ])
}

function angleBetweenVectors(a: Vector3, b: Vector3) {
  const na = normalizeVector(a)
  const nb = normalizeVector(b)
  if (!na || !nb) return 180

  const dot = clamp(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2], -1, 1)
  return (Math.acos(dot) * 180) / Math.PI
}

function groupBoundaryVectors(
  calibration: CalibrationPayload,
  axis: "x" | "y",
  target: "min" | "max",
) {
  const values = calibration.points.map((point) => axis === "x" ? point.screen[0] : point.screen[1])
  if (values.length === 0) return []

  const boundary = target === "min" ? Math.min(...values) : Math.max(...values)
  return calibration.points
    .filter((point) => {
      const value = axis === "x" ? point.screen[0] : point.screen[1]
      return Math.abs(value - boundary) <= 0.5
    })
    .map((point) => point.gaze)
}

function deriveGyroScale(calibration: CalibrationPayload): GyroScale {
  const screenWidth = Math.max(calibration.screen.width, 1)
  const screenHeight = Math.max(calibration.screen.height, 1)

  const left = averageVectors(groupBoundaryVectors(calibration, "x", "min"))
  const right = averageVectors(groupBoundaryVectors(calibration, "x", "max"))
  const top = averageVectors(groupBoundaryVectors(calibration, "y", "min"))
  const bottom = averageVectors(groupBoundaryVectors(calibration, "y", "max"))

  const horizontalAngle = left && right ? Math.max(angleBetweenVectors(left, right), 10) : 18
  const verticalAngle = top && bottom ? Math.max(angleBetweenVectors(top, bottom), 10) : 14

  return {
    pixelsPerYawDegree: (screenWidth / horizontalAngle) * gazeConfig.gyroYawMultiplier,
    pixelsPerPitchDegree: (screenHeight / verticalAngle) * gazeConfig.gyroPitchMultiplier,
    pixelsPerRollDegree: (Math.min(screenWidth, screenHeight) / 90) * gazeConfig.gyroRollMultiplier,
  }
}

function solveBasePoint(calibration: CalibrationPayload, gazeVector: Vector3) {
  const normalizedGaze = normalizeVector(gazeVector)
  if (!normalizedGaze || calibration.points.length === 0) return null

  const rankedPoints = calibration.points
    .map((point) => {
      const normalizedCalibration = normalizeVector(point.gaze)
      const angle = normalizedCalibration ? angleBetweenVectors(normalizedGaze, normalizedCalibration) : 180
      return {
        point,
        angle,
      }
    })
    .sort((left, right) => left.angle - right.angle)
    .slice(0, 4)

  if (rankedPoints.length === 0) return null

  let totalWeight = 0
  let weightedX = 0
  let weightedY = 0
  let weightedAngle = 0

  for (const candidate of rankedPoints) {
    const weight = 1 / Math.max(candidate.angle, 0.25) ** 2
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

function applyGyroCorrection(
  basePoint: Point2D,
  calibration: CalibrationPayload,
  zeroSnapshot: GyroReading,
  currentGyro: GyroReading,
) {
  const scale = deriveGyroScale(calibration)
  const yawDelta = currentGyro.yaw - zeroSnapshot.yaw
  const pitchDelta = currentGyro.pitch - zeroSnapshot.pitch
  const rollDelta = currentGyro.roll - zeroSnapshot.roll

  const correctedX = basePoint.x
    - yawDelta * scale.pixelsPerYawDegree
    + rollDelta * scale.pixelsPerRollDegree

  const correctedY = basePoint.y
    - pitchDelta * scale.pixelsPerPitchDegree
    + rollDelta * scale.pixelsPerRollDegree * 0.2

  return {
    point: {
      x: clamp(correctedX, 0, calibration.screen.width),
      y: clamp(correctedY, 0, calibration.screen.height),
    },
    gyroDelta: {
      yaw: yawDelta,
      pitch: pitchDelta,
      roll: rollDelta,
    },
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
  const alpha = jumpRatio > 0.25 ? 0.18 : jumpRatio > 0.1 ? 0.28 : 0.42

  return {
    x: previousPoint.x + (nextPoint.x - previousPoint.x) * alpha,
    y: previousPoint.y + (nextPoint.y - previousPoint.y) * alpha,
  }
}

export function solveGazePoint(input: SolveGazePointInput): SolvedGazePoint | null {
  const base = solveBasePoint(input.calibration, input.gazeVector)
  if (!base) return null

  const corrected = applyGyroCorrection(base.point, input.calibration, input.zeroSnapshot, input.currentGyro)
  const smoothed = smoothPoint(input.previousPoint, corrected.point, input.calibration)

  return {
    x: smoothed.x,
    y: smoothed.y,
    timestamp: Date.now(),
    confidence: base.confidence,
    basePoint: {
      x: base.point.x,
      y: base.point.y,
    },
    gyroDelta: corrected.gyroDelta,
  }
}
