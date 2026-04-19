import type { GazeVectorReturn, RoiRect as PackageRoiRect } from "@/lib/gaze/gaze-core"
import type { TestCalibrationData, TestCalibrationRecord } from "./gaze-core-widget-storage"
import type { GyroSnapshot } from "./gaze-core-widget-backend/types"

export type Step = "source" | "roi" | "eyeModel" | "thresholds" | "mode"
export type RoiRect = PackageRoiRect

export type EyeCornerSelection = {
  inner: [number, number] | null
  outer: [number, number] | null
}

export type EyeModelData = {
  center?: [number, number]
  dynamic_center?: [number, number]
  radius?: number
  corners?: {
    inner: [number, number]
    outer: [number, number]
  }
}

export type PreviewGazeData = {
  pupil_center?: [number, number]
  pupil_ellipse?: { center: [number, number]; axes: [number, number]; angle: number }
  screen_position?: [number, number]
  gaze_vector?: [number, number, number]
  eye_model?: EyeModelData
  pupil_score?: number
}

export type FrameState = {
  gazeData: PreviewGazeData | null
  thresholdMask: { width: number; height: number; data: Uint8Array } | null
  roi: RoiRect | null
  frameSize: { width: number; height: number } | null
}

export type RoiDrag = {
  active: boolean
  handleIndex: number
}

export type ModeVectorPoint = {
  key: string
  vector: [number, number, number]
  count: number
}

export type TestCalibrationResult = {
  data: TestCalibrationData | null
  record: TestCalibrationRecord | null
  neutralSnapshot: GyroSnapshot | null
  rawJson: string
}

export type LiveResult = GazeVectorReturn

export const STEPS: Step[] = ["source", "roi", "eyeModel", "thresholds", "mode"]

