import type { GyroSnapshot } from "./gaze-core-widget-backend/types"

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

export type TestCalibrationPoint = {
  screen: [number, number]
  gaze: [number, number, number]
  sampleCount: number
}

export type TestCalibrationData = {
  version: number
  createdAt: number
  screen: { width: number; height: number }
  points: TestCalibrationPoint[]
}

export type TestCalibrationRecord = {
  calibration: TestCalibrationData
  gyroZeroSnapshot: GyroSnapshot | null
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

function normalizeCalibrationRecord(raw: unknown): TestCalibrationRecord | null {
  if (!raw || typeof raw !== "object") return null

  const record = raw as Record<string, unknown>
  if ("calibration" in record && record.calibration && typeof record.calibration === "object") {
    return {
      calibration: record.calibration as TestCalibrationData,
      gyroZeroSnapshot: (record.gyroZeroSnapshot as GyroSnapshot | null | undefined) ?? null,
    }
  }

  if ("points" in record) {
    return {
      calibration: record as TestCalibrationData,
      gyroZeroSnapshot: null,
    }
  }

  return null
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
  writeCalibrationRecord: (record: TestCalibrationRecord) => writeJson(KEYS.calibration, record),
  clearCalibrationRecord: () => removeJson(KEYS.calibration),
}
