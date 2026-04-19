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

// ---------------------------------------------------------------------------
// 2nd-order polynomial regression:  gaze (nx, ny) → screen (sx, sy)
//
// For each axis we fit:
//   s = c0 + c1·nx + c2·ny + c3·nx·ny + c4·nx² + c5·ny²
//
// With 9 calibration points this is a 9×6 overdetermined system solved via
// the normal equations:  coeffs = (AᵀA)⁻¹ Aᵀ b
//
// This gives a smooth continuous mapping — no "pull toward calibration dots"
// like KNN.  Straight eye movements produce straight screen paths.
// ---------------------------------------------------------------------------

/** Build the 9×6 design matrix from calibration gaze vectors. */
function buildDesignMatrix(calibration: CalibrationPayload): number[][] {
  return calibration.points.map((point) => {
    const normalized = normalizeVector(point.gaze)
    const nx = normalized ? normalized[0] : 0
    const ny = normalized ? normalized[1] : 0
    return [1, nx, ny, nx * ny, nx * nx, ny * ny]
  })
}

/** Transpose an m×n matrix. */
function transpose(m: number[][]): number[][] {
  const rows = m.length
  const cols = m[0].length
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = m[i][j]
    }
  }
  return result
}

/** Multiply two matrices. */
function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length
  const cols = b[0].length
  const inner = b.length
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0
      for (let k = 0; k < inner; k++) sum += a[i][k] * b[k][j]
      result[i][j] = sum
    }
  }
  return result
}

/** Multiply a matrix by a column vector → column vector. */
function matVecMul(m: number[][], v: number[]): number[] {
  return m.map((row) => row.reduce((sum, val, i) => sum + val * v[i], 0))
}

/** Invert a small square matrix using Gauss-Jordan elimination. */
function invertMatrix(src: number[][]): number[][] | null {
  const n = src.length
  // Augmented matrix [src | I]
  const aug: number[][] = src.map((row, i) => {
    const out = new Array(2 * n).fill(0)
    for (let j = 0; j < n; j++) out[j] = row[j]
    out[n + i] = 1
    return out
  })

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col
    let maxVal = Math.abs(aug[col][col])
    for (let row = col + 1; row < n; row++) {
      const absVal = Math.abs(aug[row][col])
      if (absVal > maxVal) { maxVal = absVal; maxRow = row }
    }
    if (maxVal < 1e-12) return null // singular
    if (maxRow !== col) { const tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp }

    const pivot = aug[col][col]
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j]
    }
  }

  return aug.map((row) => row.slice(n))
}

/** Solve least-squares  A·x = b  via normal equations → (AᵀA)⁻¹ Aᵀ b. */
function leastSquares(A: number[][], b: number[]): number[] | null {
  const At = transpose(A)
  const AtA = matMul(At, A)
  const AtAinv = invertMatrix(AtA)
  if (!AtAinv) return null
  const Atb = matVecMul(At, b)
  return matVecMul(AtAinv, Atb)
}

type PolyCoeffs = { cx: number[]; cy: number[] }

/** Fit the 2nd-order polynomial from calibration data. */
function fitPolynomial(calibration: CalibrationPayload): PolyCoeffs | null {
  if (calibration.points.length < 3) return null

  const A = buildDesignMatrix(calibration)
  const bx = calibration.points.map((p) => p.screen[0])
  const by = calibration.points.map((p) => p.screen[1])

  const cx = leastSquares(A, bx)
  const cy = leastSquares(A, by)
  if (!cx || !cy) return null

  return { cx, cy }
}

/** Evaluate the polynomial at a gaze vector. */
function evalPolynomial(coeffs: PolyCoeffs, gaze: Vector3): Point2D {
  const normalized = normalizeVector(gaze)
  const nx = normalized ? normalized[0] : 0
  const ny = normalized ? normalized[1] : 0
  const features = [1, nx, ny, nx * ny, nx * nx, ny * ny]

  let x = 0
  let y = 0
  for (let i = 0; i < features.length; i++) {
    x += coeffs.cx[i] * features[i]
    y += coeffs.cy[i] * features[i]
  }
  return { x, y }
}

// ---------------------------------------------------------------------------
// Per-calibration cache so we don't re-fit every frame.
// ---------------------------------------------------------------------------
let cachedCalibrationId = ""
let cachedCoeffs: PolyCoeffs | null = null

function getCalibrationId(calibration: CalibrationPayload): string {
  return `${calibration.createdAt}-${calibration.points.length}`
}

function getOrFitPolynomial(calibration: CalibrationPayload): PolyCoeffs | null {
  const id = getCalibrationId(calibration)
  if (id === cachedCalibrationId && cachedCoeffs) return cachedCoeffs

  cachedCoeffs = fitPolynomial(calibration)
  cachedCalibrationId = id
  return cachedCoeffs
}

// ---------------------------------------------------------------------------
// Confidence: average angular distance from the current gaze to the nearest
// few calibration points.  Far outside the calibration hull → low confidence.
// ---------------------------------------------------------------------------
function estimateConfidence(calibration: CalibrationPayload, gaze: Vector3): number {
  const normalizedGaze = normalizeVector(gaze)
  if (!normalizedGaze) return 0.05

  const angles = calibration.points
    .map((p) => {
      const np = normalizeVector(p.gaze)
      if (!np) return 180
      const dot = clamp(
        normalizedGaze[0] * np[0] + normalizedGaze[1] * np[1] + normalizedGaze[2] * np[2],
        -1, 1,
      )
      return (Math.acos(dot) * 180) / Math.PI
    })
    .sort((a, b) => a - b)
    .slice(0, 3)

  const avgAngle = angles.reduce((s, a) => s + a, 0) / Math.max(angles.length, 1)
  return clamp(1 - avgAngle / 40, 0.05, 1)
}

// ---------------------------------------------------------------------------
// Temporal smoothing — same as before.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export function solveGazePoint(input: SolveGazePointInput): SolvedGazePoint | null {
  const coeffs = getOrFitPolynomial(input.calibration)
  if (!coeffs) return null

  const raw = evalPolynomial(coeffs, input.gazeVector)
  const clamped: Point2D = {
    x: clamp(raw.x, 0, input.calibration.screen.width),
    y: clamp(raw.y, 0, input.calibration.screen.height),
  }
  const smoothed = smoothPoint(input.previousPoint, clamped, input.calibration)
  const confidence = estimateConfidence(input.calibration, input.gazeVector)

  return {
    x: smoothed.x,
    y: smoothed.y,
    timestamp: Date.now(),
    confidence,
    basePoint: raw,
    gyroDelta: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 },
    compensatedGazeVector: input.gazeVector,
    motionKind: "legacy-gyro",
  }
}
