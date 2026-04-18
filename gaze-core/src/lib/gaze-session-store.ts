import type {
  CalibrationPayload,
  GazeAccessTokenClaims,
  GazeVectorPayload,
  GyroReading,
  SolvedGazePoint,
} from "./gaze-types"
import type { IssuedTokenState, LivePreviewSessionState } from "../types/gaze-session-store"

class GazeSessionStore {
  private readonly issuedTokens = new Map<string, IssuedTokenState>()
  private readonly sessions = new Map<string, LivePreviewSessionState>()

  rememberIssuedToken(claims: GazeAccessTokenClaims) {
    this.issuedTokens.set(claims.jti, {
      claims,
      gyroZeroSnapshot: this.issuedTokens.get(claims.jti)?.gyroZeroSnapshot ?? null,
    })
  }

  rememberGyroZeroSnapshot(tokenId: string, snapshot: GyroReading) {
    const existing = this.issuedTokens.get(tokenId)
    if (!existing) return

    existing.gyroZeroSnapshot = snapshot
  }

  getGyroZeroSnapshot(tokenId: string) {
    return this.issuedTokens.get(tokenId)?.gyroZeroSnapshot ?? null
  }

  openSession(socketId: string, claims: GazeAccessTokenClaims) {
    const existingTokenState = this.issuedTokens.get(claims.jti)
    const session: LivePreviewSessionState = {
      socketId,
      uuid: claims.uuid,
      tokenId: claims.jti,
      calibration: null,
      gyroZeroSnapshot: existingTokenState?.gyroZeroSnapshot ?? null,
      latestGaze: null,
      lastPoint: null,
      releaseGyroSubscription: null,
    }

    this.sessions.set(socketId, session)
    return session
  }

  getSession(socketId: string) {
    return this.sessions.get(socketId) ?? null
  }

  initializeSession(socketId: string, calibration: CalibrationPayload, gyroZeroSnapshot?: GyroReading | null) {
    const session = this.sessions.get(socketId)
    if (!session) return null

    session.calibration = calibration
    session.gyroZeroSnapshot = gyroZeroSnapshot ?? session.gyroZeroSnapshot ?? this.getGyroZeroSnapshot(session.tokenId)
    return session
  }

  setGyroRelease(socketId: string, releaseGyroSubscription: (() => void) | null) {
    const session = this.sessions.get(socketId)
    if (!session) return

    session.releaseGyroSubscription = releaseGyroSubscription
  }

  updateLatestGaze(socketId: string, gaze: GazeVectorPayload) {
    const session = this.sessions.get(socketId)
    if (!session) return null

    session.latestGaze = gaze
    return session
  }

  updateLastPoint(socketId: string, point: SolvedGazePoint) {
    const session = this.sessions.get(socketId)
    if (!session) return null

    session.lastPoint = point
    return session
  }

  closeSession(socketId: string) {
    const session = this.sessions.get(socketId)
    if (!session) return

    session.releaseGyroSubscription?.()
    this.sessions.delete(socketId)
  }
}

export const gazeSessionStore = new GazeSessionStore()
