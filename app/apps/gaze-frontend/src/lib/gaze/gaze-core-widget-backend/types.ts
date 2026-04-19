export type GyroSnapshot = {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  topic?: string
  timestamp: number
  source?: string
  kind?: "legacy-gyro" | "face-pose"
}

export type FacePoseSummary = GyroSnapshot & {
  sampleCount: number
  startedAt: number
  endedAt: number
  confidence: number
  quality?: number
}

export type WidgetCalibrationPoint = {
  screen: [number, number]
  gaze: [number, number, number]
  facePoseBaseline?: FacePoseSummary | null
  gazeSampleCount: number
  faceSampleCount: number
  captureId: string
  capturedAt: number
  quality?: number
}

export type GazeAccessTokenResponse = {
  token: string
  uuid: string
  expiresAt: string
  expiresInSeconds: number
  websocketUrl?: string
}

export type CachedAccessToken = {
  token: string
  expiresAt: number
  source: "issued" | "external"
  websocketUrl?: string
}

export type CalibrationCaptureStartResponse = {
  captureId: string
  pointIndex: number
  durationMs: number
  acceptedAt: number
  controlTopic: string
}

export type CalibrationCaptureCompleteResponse = {
  captureId: string
  point: WidgetCalibrationPoint
  neutralSnapshot: GyroSnapshot | null
}

export type PhaseZeroSettleResponse = {
  uuid: string
  snapshot: GyroSnapshot
  fallback: boolean
}
