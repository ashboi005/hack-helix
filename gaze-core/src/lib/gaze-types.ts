export type Vector3 = [number, number, number]
export type ScreenPoint = [number, number]

export type CalibrationPointPayload = {
  screen: ScreenPoint
  gaze: Vector3
  sampleCount: number
}

export type CalibrationPayload = {
  version: number
  createdAt: number
  screen: {
    width: number
    height: number
  }
  points: CalibrationPointPayload[]
}

export type GyroReading = {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  topic?: string
  timestamp: number
}

export type SessionInitPayload = {
  calibration: CalibrationPayload
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
    yaw: number
    pitch: number
    roll: number
  }
}
