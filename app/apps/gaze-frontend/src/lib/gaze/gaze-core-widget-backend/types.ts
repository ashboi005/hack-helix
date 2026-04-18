export type GyroSnapshot = {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  topic?: string
  timestamp: number
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
