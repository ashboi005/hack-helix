import { Elysia, t } from "elysia"
import { validateGazeApiKey, GazeApiKeyError } from "../lib/gaze-api-key"
import { buildWebSocketUrlFromRequest, gazeConfig } from "../lib/gaze-config"
import { solveGazePoint } from "../lib/gaze-fusion"
import { gazeMqttBridge } from "../lib/gaze-mqtt"
import { gazeSessionStore } from "../lib/gaze-session-store"
import { extractBearerToken, GazeTokenError, issueGazeAccessToken, verifyGazeAccessToken } from "../lib/gaze-token"
import type {
  CalibrationPayload,
  CalibrationRecordCompletePayload,
  CalibrationRecordStartPayload,
  GazeVectorPayload,
  GyroReading,
  SessionInitPayload,
} from "../lib/gaze-types"
import type { JsonRecord, SocketDataCarrier, SocketJsonSender, SocketTokenQueryData } from "../types/gaze"

const tokenBodySchema = t.Object({
  apiKey: t.String({ minLength: 1 }),
  metadata: t.Object({
    uuid: t.String({ minLength: 1 }),
  }),
})

const calibrationStartSchema = t.Object({
  pointIndex: t.Number(),
  target: t.Tuple([t.Number(), t.Number()]),
  durationMs: t.Number(),
  startedAt: t.Number(),
})

const calibrationCompleteSchema = t.Object({
  captureId: t.String({ minLength: 1 }),
  pointIndex: t.Number(),
  screen: t.Tuple([t.Number(), t.Number()]),
  gaze: t.Tuple([t.Number(), t.Number(), t.Number()]),
  gazeSampleCount: t.Number(),
  startedAt: t.Number(),
  endedAt: t.Number(),
  capturedAt: t.Number(),
})

function errorResponse(error: string, message: string) {
  return { error, message }
}

function buildZeroGyroReading(): GyroReading {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    timestamp: Date.now(),
    source: "fallback",
    kind: "legacy-gyro",
  }
}

async function parseJsonMessage(rawMessage: unknown) {
  if (typeof rawMessage === "string") {
    const parsed = JSON.parse(rawMessage) as unknown
    if (!parsed || typeof parsed !== "object") {
      throw new Error("WebSocket payload must be a JSON object.")
    }

    return parsed as JsonRecord
  }

  if (rawMessage instanceof ArrayBuffer) {
    return parseJsonMessage(Buffer.from(rawMessage).toString("utf8"))
  }

  if (ArrayBuffer.isView(rawMessage)) {
    const view = rawMessage as ArrayBufferView
    return parseJsonMessage(Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("utf8"))
  }

  if (rawMessage && typeof rawMessage === "object") {
    const wrapper = rawMessage as {
      data?: unknown
      text?: () => Promise<string>
      arrayBuffer?: () => Promise<ArrayBuffer>
    }

    if ("data" in wrapper && wrapper.data !== undefined) {
      return parseJsonMessage(wrapper.data)
    }

    if (typeof wrapper.text === "function") {
      return parseJsonMessage(await wrapper.text())
    }

    if (typeof wrapper.arrayBuffer === "function") {
      return parseJsonMessage(await wrapper.arrayBuffer())
    }

    return rawMessage as JsonRecord
  }

  throw new Error("WebSocket payload must be JSON text or UTF-8 bytes.")
}

function isVector3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
}

function isGyroReading(value: unknown): value is GyroReading {
  if (!value || typeof value !== "object") return false

  const record = value as JsonRecord
  return typeof record.yaw === "number"
    && typeof record.pitch === "number"
    && typeof record.roll === "number"
}

function isCalibrationPayload(value: unknown): value is CalibrationPayload {
  if (!value || typeof value !== "object") return false

  const record = value as JsonRecord
  if (!record.screen || !record.points) return false

  const screen = record.screen as JsonRecord
  if (
    typeof record.version !== "number"
    || typeof record.createdAt !== "number"
    || typeof screen.width !== "number"
    || typeof screen.height !== "number"
    || !Array.isArray(record.points)
  ) {
    return false
  }

  return record.points.every((point) => {
    if (!point || typeof point !== "object") return false

    const typedPoint = point as JsonRecord
    const hasLegacyCount = typeof typedPoint.sampleCount === "number"
    const hasFaceAwareCount = typeof typedPoint.gazeSampleCount === "number" && typeof typedPoint.faceSampleCount === "number"

    return Array.isArray(typedPoint.screen)
      && typedPoint.screen.length === 2
      && isVector3(typedPoint.gaze)
      && (hasLegacyCount || hasFaceAwareCount)
  })
}

function parseSessionInitMessage(payload: JsonRecord): SessionInitPayload | null {
  const type = typeof payload.type === "string" ? payload.type.trim().toLowerCase() : ""
  if (type !== "session.init" && type !== "live_preview_init") return null

  if (!isCalibrationPayload(payload.calibration)) {
    throw new Error("Calibration payload is required before live preview can start.")
  }

  const neutralSnapshot = payload.neutralSnapshot
  const gyroZeroSnapshot = payload.gyroZeroSnapshot
  if (neutralSnapshot !== undefined && neutralSnapshot !== null && !isGyroReading(neutralSnapshot)) {
    throw new Error("Neutral snapshot payload is invalid.")
  }
  if (gyroZeroSnapshot !== undefined && gyroZeroSnapshot !== null && !isGyroReading(gyroZeroSnapshot)) {
    throw new Error("Gyro zero snapshot payload is invalid.")
  }

  return {
    calibration: payload.calibration,
    neutralSnapshot: (neutralSnapshot as GyroReading | null | undefined) ?? (gyroZeroSnapshot as GyroReading | null | undefined) ?? null,
    gyroZeroSnapshot: (gyroZeroSnapshot as GyroReading | null | undefined) ?? null,
  }
}

function parseGazeVectorMessage(payload: JsonRecord): GazeVectorPayload | null {
  const type = typeof payload.type === "string" ? payload.type.trim().toLowerCase() : ""
  if (type !== "gaze_vector") return null

  if (!isVector3(payload.gazeVector)) {
    throw new Error("gazeVector must be a [x, y, z] tuple.")
  }

  return {
    gazeVector: payload.gazeVector,
    pupilCenter: Array.isArray(payload.pupilCenter) && payload.pupilCenter.length === 2
      ? payload.pupilCenter as [number, number]
      : undefined,
    timestamp: typeof payload.timestamp === "number" ? payload.timestamp : undefined,
  }
}

function parseSocketToken(ws: SocketDataCarrier) {
  const data = ws.data as SocketTokenQueryData
  const token = data.query?.token?.trim()
  if (!token) {
    throw new GazeTokenError("Missing websocket token.", 401, "MISSING_TOKEN")
  }

  return token
}

function sendSocketJson(ws: SocketJsonSender, payload: JsonRecord) {
  ws.send(JSON.stringify(payload))
}

function ensureCaptureAlignment(startPayload: CalibrationRecordCompletePayload, faceStartedAt: number, faceEndedAt: number) {
  const skewToleranceMs = gazeConfig.calibrationCaptureSkewToleranceMs

  if (faceEndedAt < faceStartedAt) {
    throw new Error("The face-pose capture timestamps were invalid. Please retry that point.")
  }

  const noOverlap = faceEndedAt < startPayload.startedAt - skewToleranceMs
    || faceStartedAt > startPayload.endedAt + skewToleranceMs

  if (noOverlap) {
    throw new Error("The face-pose capture was not aligned with the gaze capture window. Please retry that point.")
  }
}

function normalizeCompletePayload(body: CalibrationRecordCompletePayload) {
  if (body.gazeSampleCount < 1) {
    throw new Error("At least one gaze sample is required to complete a calibration point.")
  }

  if (body.endedAt < body.startedAt) {
    throw new Error("Calibration completion timestamps are invalid.")
  }
}

export const gazeRoutes = new Elysia({ prefix: "/gaze" })
  .post(
    "/token",
    async ({ body, request, set }) => {
      try {
        const apiKeyRecord = await validateGazeApiKey(body.apiKey)
        const issuedToken = issueGazeAccessToken({
          uuid: body.metadata.uuid.trim(),
          apiKeyId: apiKeyRecord.id,
          referenceId: apiKeyRecord.referenceId,
        })

        gazeSessionStore.rememberIssuedToken(issuedToken.claims)

        return {
          token: issuedToken.token,
          uuid: issuedToken.claims.uuid,
          expiresAt: new Date(issuedToken.expiresAt).toISOString(),
          expiresInSeconds: gazeConfig.tokenTtlSeconds,
          websocketUrl: buildWebSocketUrlFromRequest(request),
        }
      } catch (error) {
        if (error instanceof GazeApiKeyError) {
          set.status = error.status
          return errorResponse(error.code, error.message)
        }

        console.error("[GAZE] token route failed:", error)
        set.status = 500
        return errorResponse("TOKEN_ROUTE_FAILED", "Unable to issue a websocket access token.")
      }
    },
    {
      body: tokenBodySchema,
      detail: {
        tags: ["Gaze"],
      },
    },
  )
  .post(
    "/gyro-snapshot",
    async ({ request, set }) => {
      try {
        const token = extractBearerToken(request.headers.get("authorization"))
        const claims = verifyGazeAccessToken(token ?? "")
        gazeSessionStore.rememberIssuedToken(claims)

        const snapshot = await gazeMqttBridge.awaitSnapshot(claims.uuid, gazeConfig.gyroSnapshotTimeoutMs)
        gazeSessionStore.rememberNeutralSnapshot(claims.jti, snapshot)

        return {
          uuid: claims.uuid,
          snapshot,
          fallback: false,
        }
      } catch (error) {
        if (error instanceof GazeTokenError) {
          set.status = error.status
          return errorResponse(error.code, error.message)
        }

        const fallbackSnapshot = buildZeroGyroReading()

        try {
          const token = extractBearerToken(request.headers.get("authorization"))
          const claims = verifyGazeAccessToken(token ?? "")
          gazeSessionStore.rememberIssuedToken(claims)
          gazeSessionStore.rememberNeutralSnapshot(claims.jti, fallbackSnapshot)
          return {
            uuid: claims.uuid,
            snapshot: fallbackSnapshot,
            fallback: true,
          }
        } catch {
          set.status = 200
          return {
            snapshot: fallbackSnapshot,
            fallback: true,
          }
        }
      }
    },
    {
      detail: {
        tags: ["Gaze"],
      },
    },
  )
  .post(
    "/calibration/record/start",
    async ({ body, request, set }) => {
      try {
        const token = extractBearerToken(request.headers.get("authorization"))
        const claims = verifyGazeAccessToken(token ?? "")
        gazeSessionStore.rememberIssuedToken(claims)

        return await gazeMqttBridge.startCalibrationCapture(claims.uuid, body as CalibrationRecordStartPayload)
      } catch (error) {
        if (error instanceof GazeTokenError) {
          set.status = error.status
          return errorResponse(error.code, error.message)
        }

        set.status = 503
        return errorResponse(
          "CALIBRATION_CAPTURE_START_FAILED",
          error instanceof Error ? error.message : "Unable to start the calibration capture.",
        )
      }
    },
    {
      body: calibrationStartSchema,
      detail: {
        tags: ["Gaze"],
      },
    },
  )
  .post(
    "/calibration/record/complete",
    async ({ body, request, set }) => {
      const payload = body as CalibrationRecordCompletePayload

      try {
        normalizeCompletePayload(payload)

        const token = extractBearerToken(request.headers.get("authorization"))
        const claims = verifyGazeAccessToken(token ?? "")
        gazeSessionStore.rememberIssuedToken(claims)

        const pendingCapture = gazeMqttBridge.getPendingCapture(claims.uuid, payload.captureId)
        if (!pendingCapture) {
          set.status = 404
          return errorResponse("CAPTURE_NOT_FOUND", "The calibration capture could not be found. Retry this point.")
        }

        if (pendingCapture.pointIndex !== payload.pointIndex) {
          set.status = 409
          return errorResponse("CAPTURE_POINT_MISMATCH", "The calibration capture does not match the requested point.")
        }

        const faceResult = await gazeMqttBridge.awaitCalibrationCaptureResult(
          claims.uuid,
          payload.captureId,
          gazeConfig.calibrationCaptureResultTimeoutMs,
        )

        ensureCaptureAlignment(payload, faceResult.summary.startedAt, faceResult.summary.endedAt)

        if (faceResult.summary.confidence < gazeConfig.calibrationFaceConfidenceThreshold) {
          set.status = 422
          return errorResponse("FACE_POSE_TOO_NOISY", "Face tracking was too noisy for this point. Please retry it.")
        }

        const point = {
          screen: payload.screen,
          gaze: payload.gaze,
          facePoseBaseline: faceResult.summary,
          gazeSampleCount: payload.gazeSampleCount,
          faceSampleCount: faceResult.summary.sampleCount,
          captureId: payload.captureId,
          capturedAt: payload.capturedAt,
          quality: Math.min(1, Math.max(faceResult.summary.confidence, faceResult.summary.quality ?? 0)),
        }

        // Never auto-set the neutral snapshot from a single calibration point.
        // The neutral is either already set via the explicit /gyro-snapshot endpoint,
        // or it will be computed on the frontend as the average of all calibration
        // baselines once all points are captured.
        const existingNeutralSnapshot = gazeSessionStore.getNeutralSnapshot(claims.jti)

        gazeMqttBridge.clearPendingCapture(claims.uuid, payload.captureId)

        return {
          captureId: payload.captureId,
          point,
          neutralSnapshot: existingNeutralSnapshot ?? null,
        }
      } catch (error) {
        if (error instanceof GazeTokenError) {
          set.status = error.status
          return errorResponse(error.code, error.message)
        }

        set.status = 422
        return errorResponse(
          "CALIBRATION_CAPTURE_COMPLETE_FAILED",
          error instanceof Error ? error.message : "Unable to complete the calibration capture.",
        )
      }
    },
    {
      body: calibrationCompleteSchema,
      detail: {
        tags: ["Gaze"],
      },
    },
  )
  .post(
    "/calibration/phase-zero-settle",
    async ({ request, set }) => {
      try {
        const token = extractBearerToken(request.headers.get("authorization"))
        const claims = verifyGazeAccessToken(token ?? "")
        gazeSessionStore.rememberIssuedToken(claims)

        const snapshot = await gazeMqttBridge.awaitSnapshot(claims.uuid, gazeConfig.gyroSnapshotTimeoutMs)
        gazeSessionStore.rememberNeutralSnapshot(claims.jti, snapshot)

        return {
          uuid: claims.uuid,
          snapshot,
          fallback: false,
        }
      } catch (error) {
        if (error instanceof GazeTokenError) {
          set.status = error.status
          return errorResponse(error.code, error.message)
        }

        const fallbackSnapshot = buildZeroGyroReading()
        try {
          const token = extractBearerToken(request.headers.get("authorization"))
          const claims = verifyGazeAccessToken(token ?? "")
          gazeSessionStore.rememberIssuedToken(claims)
          gazeSessionStore.rememberNeutralSnapshot(claims.jti, fallbackSnapshot)
          return {
            uuid: claims.uuid,
            snapshot: fallbackSnapshot,
            fallback: true,
          }
        } catch {
          set.status = 200
          return {
            snapshot: fallbackSnapshot,
            fallback: true,
          }
        }
      }
    },
    {
      detail: {
        tags: ["Gaze"],
      },
    },
  )
  .ws("/screen/ws", {
    async open(ws) {
      try {
        const token = parseSocketToken(ws)
        const claims = verifyGazeAccessToken(token)
        gazeSessionStore.rememberIssuedToken(claims)
        gazeSessionStore.openSession(ws.id, claims)

        let releaseGyroSubscription: (() => void) | null = null
        try {
          releaseGyroSubscription = await gazeMqttBridge.retainSubscription(claims.uuid)
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error"
          console.warn(`[GAZE] MQTT subscription unavailable for ${claims.uuid}. Falling back to zero gyro.`, message)
        }

        gazeSessionStore.setGyroRelease(ws.id, releaseGyroSubscription)

        sendSocketJson(ws, {
          type: "connected",
          uuid: claims.uuid,
          sessionId: ws.id,
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unable to open live preview session."
        ws.close(4401, reason)
      }
    },
    async message(ws, rawMessage) {
      const session = gazeSessionStore.getSession(ws.id)
      if (!session) {
        sendSocketJson(ws, {
          type: "error",
          op: "session",
          detail: "Live preview session was not initialized.",
        })
        return
      }

      try {
        const payload = await parseJsonMessage(rawMessage)
        const sessionInit = parseSessionInitMessage(payload)
        if (sessionInit) {
          const initializedSession = gazeSessionStore.initializeSession(
            ws.id,
            sessionInit.calibration,
            sessionInit.neutralSnapshot ?? sessionInit.gyroZeroSnapshot ?? null,
          )
          if (!initializedSession) {
            sendSocketJson(ws, {
              type: "error",
              op: "session.init",
              detail: "Unable to initialize the live preview session.",
            })
            return
          }

          sendSocketJson(ws, {
            type: "ack",
            op: "session.init",
            data: {
              uuid: initializedSession.uuid,
              ready: true,
            },
          })
          return
        }

        const gazeVector = parseGazeVectorMessage(payload)
        if (gazeVector) {
          const updatedSession = gazeSessionStore.updateLatestGaze(ws.id, gazeVector)
          if (!updatedSession?.calibration) {
            sendSocketJson(ws, {
              type: "error",
              op: "gaze_vector",
              detail: "Calibration bundle is missing. Send session.init before streaming gaze vectors.",
            })
            return
          }

          const solvedPoint = solveGazePoint({
            calibration: updatedSession.calibration,
            gazeVector: gazeVector.gazeVector,
            previousPoint: updatedSession.lastPoint
              ? { x: updatedSession.lastPoint.x, y: updatedSession.lastPoint.y }
              : null,
          })

          if (!solvedPoint) return

          gazeSessionStore.updateLastPoint(ws.id, solvedPoint)
          sendSocketJson(ws, {
            type: "live_preview_point",
            x: solvedPoint.x,
            y: solvedPoint.y,
            timestamp: solvedPoint.timestamp,
            confidence: solvedPoint.confidence,
            payload: {
              coordinates: {
                x: solvedPoint.x,
                y: solvedPoint.y,
              },
              basePoint: solvedPoint.basePoint,
              gyroDelta: solvedPoint.gyroDelta,
              compensatedGazeVector: solvedPoint.compensatedGazeVector,
              motionKind: solvedPoint.motionKind,
            },
          })
          return
        }

        if ((payload.type as string | undefined)?.toLowerCase() === "ping") {
          sendSocketJson(ws, { type: "pong" })
          return
        }

        sendSocketJson(ws, {
          type: "error",
          op: "message",
          detail: "Unsupported websocket message type.",
        })
      } catch (error) {
        sendSocketJson(ws, {
          type: "error",
          op: "message",
          detail: error instanceof Error ? error.message : "Invalid websocket payload.",
        })
      }
    },
    close(ws) {
      gazeSessionStore.closeSession(ws.id)
    },
    detail: {
      tags: ["Gaze"],
    },
  })
