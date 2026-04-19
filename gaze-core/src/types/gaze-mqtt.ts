import type { FacePoseSummary, GyroReading, ScreenPoint } from "@/lib/gaze-types"

export type GyroWaiter = {
  minTimestamp: number
  resolve: (reading: GyroReading) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export type CalibrationCaptureRecord = {
  uuid: string
  captureId: string
  pointIndex: number
  target: ScreenPoint
  durationMs: number
  startedAt: number
  acceptedAt: number
  controlTopic: string
  resultTopic: string
}

export type CalibrationCaptureResult = {
  uuid: string
  captureId: string
  pointIndex: number
  summary: FacePoseSummary
}

export type TopicSubscription = {
  uuid: string
  topic: string
  refCount: number
}

export type GyroPayloadRecord = Record<string, unknown>

export type CalibrationResultWaiter = {
  resolve: (result: CalibrationCaptureResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}
