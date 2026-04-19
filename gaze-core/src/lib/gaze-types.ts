export type Vector3 = [number, number, number]
export type ScreenPoint = [number, number]
export type MotionSourceKind = "legacy-gyro" | "face-pose"

export type GyroReading = {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  topic?: string
  timestamp: number
  source?: string
  kind?: MotionSourceKind
}

export type FacePoseSummary = GyroReading & {
  sampleCount: number
  startedAt: number
  endedAt: number
  confidence: number
  quality?: number
}

export type CalibrationPointPayload = {
  screen: ScreenPoint
  gaze: Vector3
  facePoseBaseline: FacePoseSummary
  gazeSampleCount: number
  faceSampleCount: number
  captureId: string
  capturedAt: number
  quality?: number
}

export type CalibrationPayload = {
  version: number
  createdAt: number
  screen: {
    width: number
    height: number
  }
  points: CalibrationPointPayload[]
  neutralSnapshot?: GyroReading | null
}

export type SessionInitPayload = {
  calibration: CalibrationPayload
  neutralSnapshot?: GyroReading | null
  gyroZeroSnapshot?: GyroReading | null
}

export type GazeVectorPayload = {
  gazeVector: Vector3
  pupilCenter?: ScreenPoint
  timestamp?: number
}

export type GazeAccessTokenClaims = {
  sub: string
  uuid: string
  scope: "gaze:session"
  iss: string
  aud: string
  iat: number
  exp: number
  jti: string
  apiKeyId: string
  referenceId: string
}

export type SolvedGazePoint = {
  x: number
  y: number
  timestamp: number
  confidence: number
  basePoint: {
    x: number
    y: number
  }
  gyroDelta: {
    x: number
    y: number
    z: number
    yaw: number
    pitch: number
    roll: number
  }
  compensatedGazeVector: Vector3
  motionKind: MotionSourceKind
}

export type CalibrationRecordStartPayload = {
  pointIndex: number
  target: ScreenPoint
  durationMs: number
  startedAt: number
}

export type CalibrationRecordStartResponse = {
  captureId: string
  pointIndex: number
  durationMs: number
  acceptedAt: number
  controlTopic: string
}

export type CalibrationRecordCompletePayload = {
  captureId: string
  pointIndex: number
  screen: ScreenPoint
  gaze: Vector3
  gazeSampleCount: number
  startedAt: number
  endedAt: number
  capturedAt: number
}

export type CalibrationRecordCompleteResponse = {
  captureId: string
  point: CalibrationPointPayload
  neutralSnapshot: GyroReading | null
}

export type PhaseZeroSettleResponse = {
  uuid: string
  snapshot: GyroReading
  fallback: boolean
}
