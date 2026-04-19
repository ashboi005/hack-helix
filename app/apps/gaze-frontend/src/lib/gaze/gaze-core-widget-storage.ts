import type { GyroSnapshot, WidgetCalibrationPoint } from "./gaze-core-widget-backend/types"

const KEYS = {
  prefs: "gaze-core-test-tracker-prefs",
  calibration: "gaze-core-test-calibration",
} as const

export type TestSetupPrefs = {
  kind: "usb" | "network"
  source: string
  roi: { x: number; y: number; width: number; height: number }
  eyeCorners: {
    inner: [number, number] | null
    outer: [number, number] | null
  }
  parameters: {
    pupilThreshold: number
    pupilBlur: number
  }
}

export type TestCalibrationPoint = WidgetCalibrationPoint

export type TestCalibrationData = {
  version: number
  createdAt: number
  screen: { width: number; height: number }
  points: TestCalibrationPoint[]
  neutralSnapshot?: GyroSnapshot | null
}

export type TestCalibrationRecord = {
  calibration: TestCalibrationData
  neutralSnapshot: GyroSnapshot | null
}

type LegacyCalibrationPoint = {
  screen: [number, number]
  gaze: [number, number, number]
  sampleCount: number
}

type LegacyCalibrationData = {
  version: number
  createdAt: number
  screen: { width: number; height: number }
  points: LegacyCalibrationPoint[]
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function removeJson(key: string): void {
  localStorage.removeItem(key)
}

function toFallbackSnapshot(): GyroSnapshot {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    timestamp: Date.now(),
    source: "legacy-fallback",
    kind: "legacy-gyro",
  }
}

function normalizeLegacyPoint(point: LegacyCalibrationPoint, index: number): TestCalibrationPoint {
  const fallbackSnapshot = toFallbackSnapshot()
  return {
    screen: point.screen,
    gaze: point.gaze,
    facePoseBaseline: {
      ...fallbackSnapshot,
      sampleCount: Math.max(1, point.sampleCount),
      startedAt: fallbackSnapshot.timestamp,
      endedAt: fallbackSnapshot.timestamp,
      confidence: 0,
      quality: 0,
    },
    gazeSampleCount: Math.max(1, point.sampleCount),
    faceSampleCount: 0,
    captureId: `legacy-${index}`,
    capturedAt: fallbackSnapshot.timestamp,
    quality: 0,
  }
}

function normalizeCalibrationRecord(raw: unknown): TestCalibrationRecord | null {
  if (!raw || typeof raw !== "object") return null

  const record = raw as Record<string, unknown>
  if ("calibration" in record && record.calibration && typeof record.calibration === "object") {
    const calibration = record.calibration as TestCalibrationData
    const neutralSnapshot = (record.neutralSnapshot as GyroSnapshot | null | undefined)
      ?? (record.gyroZeroSnapshot as GyroSnapshot | null | undefined)
      ?? calibration.neutralSnapshot
      ?? calibration.points[0]?.facePoseBaseline
      ?? null

    return {
      calibration: {
        ...calibration,
        version: calibration.version >= 2 ? calibration.version : 2,
        neutralSnapshot,
        points: calibration.points,
      },
      neutralSnapshot,
    }
  }

  if ("points" in record) {
    const calibration = record as LegacyCalibrationData
    const points = calibration.points.map(normalizeLegacyPoint)
    const neutralSnapshot = points[0]?.facePoseBaseline ?? null

    return {
      calibration: {
        version: 2,
        createdAt: calibration.createdAt,
        screen: calibration.screen,
        points,
        neutralSnapshot,
      },
      neutralSnapshot,
    }
  }

  return null
}

function buildRecordFromCalibration(calibration: TestCalibrationData): TestCalibrationRecord {
  const neutralSnapshot = calibration.neutralSnapshot ?? calibration.points[0]?.facePoseBaseline ?? null
  return {
    calibration: {
      ...calibration,
      neutralSnapshot,
    },
    neutralSnapshot,
  }
}

export function defaultTestPrefs(): TestSetupPrefs {
  return {
    kind: "usb",
    source: "0",
    roi: { x: 0, y: 0, width: 640, height: 480 },
    eyeCorners: { inner: null, outer: null },
    parameters: { pupilThreshold: 50, pupilBlur: 3 },
  }
}

export const testEyeTrackerStorage = {
  readPrefs: () => readJson<TestSetupPrefs>(KEYS.prefs, defaultTestPrefs()),
  writePrefs: (prefs: TestSetupPrefs) => writeJson(KEYS.prefs, prefs),
  readCalibrationRecord: () => normalizeCalibrationRecord(readJson<unknown>(KEYS.calibration, null)),
  readCalibration: () => normalizeCalibrationRecord(readJson<unknown>(KEYS.calibration, null))?.calibration ?? null,
  writeCalibrationRecord: (record: TestCalibrationRecord) => writeJson(KEYS.calibration, record),
  writeCalibration: (calibration: TestCalibrationData) =>
    writeJson(
      KEYS.calibration,
      buildRecordFromCalibration(calibration),
    ),
  clearCalibrationRecord: () => removeJson(KEYS.calibration),
}
