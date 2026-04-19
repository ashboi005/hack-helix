import { gazeConfig } from "./gaze-config"
import type { CalibrationPayload, CalibrationPointPayload, GyroReading, MotionSourceKind, SolvedGazePoint, Vector3 } from "./gaze-types"
import type { GyroScale, MotionDelta, Point2D, SolveGazePointInput } from "../types/gaze-fusion"

function clamp(value: number, minValue: number, maxValue: number) {
  return Math.max(minValue, Math.min(maxValue, value))
}

function clampAbs(value: number, maxAbsValue: number) {
  const safeMaxAbs = Math.abs(maxAbsValue)
  return clamp(value, -safeMaxAbs, safeMaxAbs)
}

function applyDeadzone(value: number, threshold: number) {
  if (!Number.isFinite(value)) return 0
  return Math.abs(value) < Math.abs(threshold) ? 0 : value
}

function averageNumber(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
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

function multiplyMatrices(left: number[][], right: number[][]) {
  return left.map((row) =>
    right[0].map((_, columnIndex) =>
      row.reduce((sum, value, rowIndex) => sum + value * right[rowIndex][columnIndex], 0),
    ))
}

function multiplyMatrixVector(matrix: number[][], vector: Vector3): Vector3 {
  return matrix.map((row) =>
    row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]) as Vector3
}

function transposeMatrix(matrix: number[][]) {
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]))
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

function inferHorizontalMirrorSign(calibration: CalibrationPayload): number | null {
  if (!gazeConfig.headPoseAutoMirrorHorizontal || calibration.points.length < 2) {
    return null
  }

  const xValues = calibration.points.map((point) => point.screen[0])
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const xSpan = Math.abs(maxX - minX)
  if (xSpan <= 1e-6) return null

  const leftPoints = calibration.points.filter((point) => Math.abs(point.screen[0] - minX) <= 0.5)
  const rightPoints = calibration.points.filter((point) => Math.abs(point.screen[0] - maxX) <= 0.5)

  const leftGazeX = averageNumber(leftPoints.map((point) => point.gaze[0]))
  const rightGazeX = averageNumber(rightPoints.map((point) => point.gaze[0]))
  const leftYaw = averageNumber(
    leftPoints
      .map((point) => point.facePoseBaseline?.yaw)
      .filter((value): value is number => Number.isFinite(value as number)),
  )
  const rightYaw = averageNumber(
    rightPoints
      .map((point) => point.facePoseBaseline?.yaw)
      .filter((value): value is number => Number.isFinite(value as number)),
  )

  const gazeSpan = leftGazeX !== null && rightGazeX !== null ? rightGazeX - leftGazeX : null
  const yawSpan = leftYaw !== null && rightYaw !== null ? rightYaw - leftYaw : null

  if (gazeSpan !== null && yawSpan !== null && Math.abs(gazeSpan) > 1e-4 && Math.abs(yawSpan) > 1e-2) {
    return Math.sign(gazeSpan) === Math.sign(yawSpan) ? 1 : -1
  }

  let gazeCovariance = 0
  let yawCovariance = 0
  const midpoint = calibration.screen.width / 2

  for (const point of calibration.points) {
    const centeredX = (point.screen[0] - midpoint) / Math.max(calibration.screen.width, 1)
    gazeCovariance += centeredX * point.gaze[0]
    const yaw = point.facePoseBaseline?.yaw
    if (typeof yaw === "number" && Number.isFinite(yaw)) {
      yawCovariance += centeredX * yaw
    }
  }

  if (Math.abs(gazeCovariance) <= 1e-6 || Math.abs(yawCovariance) <= 1e-6) {
    return null
  }

  return Math.sign(gazeCovariance) === Math.sign(yawCovariance) ? 1 : -1
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

function deriveMotionDelta(zeroSnapshot: GyroReading, currentGyro: GyroReading): MotionDelta {
  return {
    x: currentGyro.x - zeroSnapshot.x,
    y: currentGyro.y - zeroSnapshot.y,
    z: currentGyro.z - zeroSnapshot.z,
    yaw: currentGyro.yaw - zeroSnapshot.yaw,
    pitch: currentGyro.pitch - zeroSnapshot.pitch,
    roll: currentGyro.roll - zeroSnapshot.roll,
  }
}

function normalizeMotionDeltaForCalibration(
  motionDelta: MotionDelta,
  horizontalMirrorSign: number,
): MotionDelta {
  const safeSign = horizontalMirrorSign < 0 ? -1 : 1

  return {
    x: clampAbs(applyDeadzone(motionDelta.x * safeSign, gazeConfig.headPoseTranslationDeadzone), 50),
    y: clampAbs(applyDeadzone(motionDelta.y, gazeConfig.headPoseTranslationDeadzone), 50),
    z: clampAbs(applyDeadzone(motionDelta.z, gazeConfig.headPoseTranslationDeadzone), 50),
    yaw: clampAbs(applyDeadzone(motionDelta.yaw * safeSign, gazeConfig.headPoseYawDeadzoneDeg), 30),
    pitch: clampAbs(applyDeadzone(motionDelta.pitch, gazeConfig.headPosePitchDeadzoneDeg), 30),
    roll: clampAbs(applyDeadzone(motionDelta.roll * safeSign, gazeConfig.headPoseRollDeadzoneDeg), 25),
  }
}

function resolveMotionKind(currentGyro: GyroReading): MotionSourceKind {
  return currentGyro.kind ?? "legacy-gyro"
}

function compensateGazeVectorWithHeadPose(
  gazeVector: Vector3,
  motionDelta: MotionDelta,
): Vector3 {
  const normalizedGaze = normalizeVector(gazeVector)
  if (!normalizedGaze) {
    return gazeVector
  }

  const yaw = degreesToRadians(-motionDelta.yaw * gazeConfig.headPoseYawCompensation)
  const pitch = degreesToRadians(-motionDelta.pitch * gazeConfig.headPosePitchCompensation)
  const roll = degreesToRadians(-motionDelta.roll * gazeConfig.headPoseRollCompensation)

  const yawMatrix = [
    [Math.cos(yaw), 0, Math.sin(yaw)],
    [0, 1, 0],
    [-Math.sin(yaw), 0, Math.cos(yaw)],
  ]

  const pitchMatrix = [
    [1, 0, 0],
    [0, Math.cos(pitch), -Math.sin(pitch)],
    [0, Math.sin(pitch), Math.cos(pitch)],
  ]

  const rollMatrix = [
    [Math.cos(roll), -Math.sin(roll), 0],
    [Math.sin(roll), Math.cos(roll), 0],
    [0, 0, 1],
  ]

  const combinedRotation = multiplyMatrices(rollMatrix, multiplyMatrices(pitchMatrix, yawMatrix))
  const compensated = multiplyMatrixVector(transposeMatrix(combinedRotation), normalizedGaze)
  return normalizeVector(compensated) ?? gazeVector
}

function scoreCalibrationPoint(
  point: CalibrationPointPayload,
  gazeVector: Vector3,
) {
  const normalizedCalibration = normalizeVector(point.gaze)
  const rawAngle = normalizedCalibration ? angleBetweenVectors(gazeVector, normalizedCalibration) : 180

  return {
    point,
    angle: rawAngle,
    rawAngle,
  }
}

function solveBasePoint(
  calibration: CalibrationPayload,
  gazeVector: Vector3,
) {
  const normalizedGaze = normalizeVector(gazeVector)
  if (!normalizedGaze || calibration.points.length === 0) return null

  const rankedPoints = calibration.points
    .map((point) => scoreCalibrationPoint(point, normalizedGaze))
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
    weightedAngle += candidate.rawAngle * weight
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

function applyLegacyGyroCorrection(
  basePoint: Point2D,
  calibration: CalibrationPayload,
  motionDelta: MotionDelta,
) {
  const scale = deriveGyroScale(calibration)

  const correctedX = basePoint.x
    - motionDelta.yaw * scale.pixelsPerYawDegree
    + motionDelta.roll * scale.pixelsPerRollDegree

  const correctedY = basePoint.y
    - motionDelta.pitch * scale.pixelsPerPitchDegree
    + motionDelta.roll * scale.pixelsPerRollDegree * 0.2

  return {
    point: {
      x: clamp(correctedX, 0, calibration.screen.width),
      y: clamp(correctedY, 0, calibration.screen.height),
    },
  }
}

function applyFacePoseCorrection(
  basePoint: Point2D,
  calibration: CalibrationPayload,
  motionDelta: MotionDelta,
) {
  const scale = deriveGyroScale(calibration)

  const yawCorrectionPx = motionDelta.yaw * scale.pixelsPerYawDegree * gazeConfig.headPoseYawCompensation
  const pitchCorrectionPx = motionDelta.pitch * scale.pixelsPerPitchDegree * gazeConfig.headPosePitchCompensation
  const rollCorrectionPx = motionDelta.roll * scale.pixelsPerRollDegree * gazeConfig.headPoseRollCompensation

  const correctedX = basePoint.x
    - yawCorrectionPx
    + rollCorrectionPx * 0.12
    - motionDelta.x * gazeConfig.headTranslationXMultiplier
    - motionDelta.z * gazeConfig.headTranslationZMultiplier * 0.15

  const correctedY = basePoint.y
    - pitchCorrectionPx
    + rollCorrectionPx * 0.06
    - motionDelta.y * gazeConfig.headTranslationYMultiplier
    + motionDelta.z * gazeConfig.headTranslationZMultiplier * 0.08

  return {
    point: {
      x: clamp(correctedX, 0, calibration.screen.width),
      y: clamp(correctedY, 0, calibration.screen.height),
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
  const alpha = jumpRatio > 0.25 ? 0.12 : jumpRatio > 0.1 ? 0.2 : 0.32

  return {
    x: previousPoint.x + (nextPoint.x - previousPoint.x) * alpha,
    y: previousPoint.y + (nextPoint.y - previousPoint.y) * alpha,
  }
}

export function solveGazePoint(input: SolveGazePointInput): SolvedGazePoint | null {
  const motionKind = resolveMotionKind(input.currentGyro)
  const configuredHorizontalSign = gazeConfig.headPoseHorizontalSign < 0 ? -1 : 1
  const inferredHorizontalSign = motionKind === "face-pose"
    ? inferHorizontalMirrorSign(input.calibration)
    : null

  const horizontalMirrorSign = motionKind === "face-pose"
    ? inferredHorizontalSign ?? configuredHorizontalSign
    : 1

  const motionDelta = normalizeMotionDeltaForCalibration(
    deriveMotionDelta(input.zeroSnapshot, input.currentGyro),
    horizontalMirrorSign,
  )

  const compensatedGazeVector = motionKind === "face-pose"
    ? compensateGazeVectorWithHeadPose(input.gazeVector, motionDelta)
    : input.gazeVector

  const base = solveBasePoint(
    input.calibration,
    compensatedGazeVector,
  )
  if (!base) return null

  const corrected = motionKind === "face-pose"
    ? applyFacePoseCorrection(base.point, input.calibration, motionDelta)
    : applyLegacyGyroCorrection(base.point, input.calibration, motionDelta)
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
    gyroDelta: motionDelta,
    compensatedGazeVector,
    motionKind,
  }
}
