import { randomUUID } from "node:crypto"
import mqtt, { type MqttClient } from "mqtt"
import {
  buildCalibrationControlTopic,
  buildCalibrationResultTopic,
  buildGyroTopic,
  gazeConfig,
} from "./gaze-config"
import type {
  CalibrationRecordStartPayload,
  FacePoseSummary,
  GyroReading,
  MotionSourceKind,
} from "./gaze-types"
import type {
  CalibrationCaptureRecord,
  CalibrationCaptureResult,
  CalibrationResultWaiter,
  GyroPayloadRecord,
  GyroWaiter,
  TopicSubscription,
} from "../types/gaze-mqtt"

function readRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function readFiniteNumber(...candidates: unknown[]) {
  for (const candidate of candidates) {
    const parsed = Number(candidate)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function resolveMotionKind(
  rawKind: unknown,
  source: string | null,
  hasExplicitPose: boolean,
): MotionSourceKind {
  const normalizedKind = typeof rawKind === "string" ? rawKind.trim().toLowerCase() : ""
  if (normalizedKind === "face-pose") {
    return "face-pose"
  }

  if (hasExplicitPose) {
    return "face-pose"
  }

  return source?.toLowerCase().includes("mediapipe") ? "face-pose" : "legacy-gyro"
}

function parseGyroPayload(
  payload: string,
): Pick<GyroReading, "x" | "y" | "z" | "yaw" | "pitch" | "roll" | "source" | "kind"> | null {
  const raw = payload.trim()
  if (!raw) return null

  const parts = raw.split(",").map((part) => part.trim())
  if (parts.length === 3) {
    const [yaw, pitch, roll] = parts.map(Number)
    if ([yaw, pitch, roll].every((value) => Number.isFinite(value))) {
      return {
        x: yaw,
        y: pitch,
        z: roll,
        yaw,
        pitch,
        roll,
        source: "legacy-csv",
        kind: "legacy-gyro",
      }
    }
  }

  try {
    const decoded = JSON.parse(raw) as GyroPayloadRecord
    const position = readRecord(decoded.position)
    const rotation = readRecord(decoded.rotation)
    const source = typeof decoded.source === "string" ? decoded.source.trim() : null
    const kind = resolveMotionKind(decoded.kind, source, Boolean(position && rotation))

    const yaw = readFiniteNumber(rotation?.yaw, decoded.yaw, decoded.heading, decoded.x)
    const pitch = readFiniteNumber(rotation?.pitch, decoded.pitch, decoded.y)
    const roll = readFiniteNumber(rotation?.roll, decoded.roll, decoded.z)
    const x = readFiniteNumber(position?.x, decoded.x, decoded.tx, yaw)
    const y = readFiniteNumber(position?.y, decoded.y, decoded.ty, pitch)
    const z = readFiniteNumber(position?.z, decoded.z, decoded.tz, roll)

    if ([x, y, z, yaw, pitch, roll].every((value) => value !== null)) {
      return {
        x: x as number,
        y: y as number,
        z: z as number,
        yaw: yaw as number,
        pitch: pitch as number,
        roll: roll as number,
        source: source ?? undefined,
        kind,
      }
    }
  } catch {
    return null
  }

  return null
}

function parseCalibrationResultPayload(payload: string): CalibrationCaptureResult | null {
  try {
    const decoded = JSON.parse(payload) as Record<string, unknown>
    const summaryRecord = readRecord(decoded.summary)
    if (!summaryRecord) return null

    const uuid = typeof decoded.uuid === "string" ? decoded.uuid.trim() : ""
    const captureId = typeof decoded.captureId === "string" ? decoded.captureId.trim() : ""
    const pointIndex = Number(decoded.pointIndex)
    const source = typeof summaryRecord.source === "string" ? summaryRecord.source.trim() : "mediapipe-face-vector"
    const kind = resolveMotionKind(summaryRecord.kind, source, true)

    const x = readFiniteNumber(summaryRecord.x)
    const y = readFiniteNumber(summaryRecord.y)
    const z = readFiniteNumber(summaryRecord.z)
    const yaw = readFiniteNumber(summaryRecord.yaw)
    const pitch = readFiniteNumber(summaryRecord.pitch)
    const roll = readFiniteNumber(summaryRecord.roll)
    const timestamp = readFiniteNumber(summaryRecord.timestamp, decoded.timestamp)
    const startedAt = readFiniteNumber(summaryRecord.startedAt)
    const endedAt = readFiniteNumber(summaryRecord.endedAt)
    const sampleCount = readFiniteNumber(summaryRecord.sampleCount)
    const confidence = readFiniteNumber(summaryRecord.confidence, summaryRecord.quality, 0)
    const quality = readFiniteNumber(summaryRecord.quality, confidence)

    if (!uuid || !captureId || !Number.isFinite(pointIndex)) return null
    if ([x, y, z, yaw, pitch, roll, timestamp, startedAt, endedAt, sampleCount, confidence].some((value) => value === null)) {
      return null
    }

    const summary: FacePoseSummary = {
      x: x as number,
      y: y as number,
      z: z as number,
      yaw: yaw as number,
      pitch: pitch as number,
      roll: roll as number,
      timestamp: timestamp as number,
      source,
      kind,
      sampleCount: sampleCount as number,
      startedAt: startedAt as number,
      endedAt: endedAt as number,
      confidence: confidence as number,
      quality: quality ?? undefined,
    }

    return {
      uuid,
      captureId,
      pointIndex,
      summary,
    }
  } catch {
    return null
  }
}

class GazeMqttBridge {
  private client: MqttClient | null = null
  private connected = false
  private connectPromise: Promise<void> | null = null
  private readonly latestReadings = new Map<string, GyroReading>()
  private readonly subscriptionsByUuid = new Map<string, TopicSubscription>()
  private readonly calibrationResultSubscriptions = new Set<string>()
  private readonly uuidByTopic = new Map<string, string>()
  private readonly waitersByUuid = new Map<string, Set<GyroWaiter>>()
  private readonly pendingCaptures = new Map<string, CalibrationCaptureRecord>()
  private readonly captureResults = new Map<string, CalibrationCaptureResult>()
  private readonly captureWaiters = new Map<string, Set<CalibrationResultWaiter>>()

  private buildZeroGyroReading(topic?: string): GyroReading {
    return {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      topic,
      timestamp: Date.now(),
      source: "fallback",
      kind: "legacy-gyro",
    }
  }

  private captureKey(uuid: string, captureId: string) {
    return `${uuid.trim()}::${captureId.trim()}`
  }

  private ensureClient() {
    if (this.client) return this.client

    const client = mqtt.connect(gazeConfig.mqttBrokerUrl, {
      clientId: `${gazeConfig.mqttClientIdPrefix}-${randomUUID().slice(0, 8)}`,
      reconnectPeriod: 2000,
      keepalive: 60,
    })

    client.on("connect", () => {
      this.connected = true

      for (const subscription of this.subscriptionsByUuid.values()) {
        client.subscribe(subscription.topic)
      }

      for (const uuid of this.calibrationResultSubscriptions.values()) {
        client.subscribe(buildCalibrationResultTopic(uuid))
      }
    })

    client.on("reconnect", () => {
      this.connected = false
    })

    client.on("close", () => {
      this.connected = false
    })

    client.on("error", (error) => {
      console.error("[MQTT] bridge error:", error)
    })

    client.on("message", (topic, payloadBuffer) => {
      const uuid = this.uuidByTopic.get(topic)
      if (!uuid) return

      if (topic === buildCalibrationResultTopic(uuid)) {
        const result = parseCalibrationResultPayload(payloadBuffer.toString("utf8"))
        if (!result) return

        const key = this.captureKey(result.uuid, result.captureId)
        this.captureResults.set(key, result)

        const waiters = this.captureWaiters.get(key)
        if (!waiters || waiters.size === 0) return

        for (const waiter of [...waiters]) {
          clearTimeout(waiter.timeout)
          waiters.delete(waiter)
          waiter.resolve(result)
        }

        if (waiters.size === 0) {
          this.captureWaiters.delete(key)
        }

        return
      }

      const parsed = parseGyroPayload(payloadBuffer.toString("utf8"))
      if (!parsed) return

      const reading: GyroReading = {
        ...parsed,
        topic,
        timestamp: Date.now(),
      }

      this.latestReadings.set(uuid, reading)

      const waiters = this.waitersByUuid.get(uuid)
      if (!waiters || waiters.size === 0) return

      for (const waiter of [...waiters]) {
        if (reading.timestamp < waiter.minTimestamp) continue

        clearTimeout(waiter.timeout)
        waiters.delete(waiter)
        waiter.resolve(reading)
      }

      if (waiters.size === 0) {
        this.waitersByUuid.delete(uuid)
      }
    })

    this.client = client
    return client
  }

  private async waitUntilConnected() {
    if (this.connected) return
    if (this.connectPromise) {
      await this.connectPromise
      return
    }

    const client = this.ensureClient()
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error("Timed out while connecting to the MQTT broker."))
      }, 6000)

      const handleConnect = () => {
        cleanup()
        this.connected = true
        resolve()
      }

      const handleError = (error: Error) => {
        cleanup()
        reject(error)
      }

      const cleanup = () => {
        clearTimeout(timeout)
        client.off("connect", handleConnect)
        client.off("error", handleError)
        this.connectPromise = null
      }

      client.on("connect", handleConnect)
      client.on("error", handleError)
    })

    await this.connectPromise
  }

  private async retainCalibrationResultSubscription(uuid: string) {
    const normalizedUuid = uuid.trim()
    if (!normalizedUuid || this.calibrationResultSubscriptions.has(normalizedUuid)) {
      return
    }

    this.calibrationResultSubscriptions.add(normalizedUuid)
    const resultTopic = buildCalibrationResultTopic(normalizedUuid)
    this.uuidByTopic.set(resultTopic, normalizedUuid)

    try {
      await this.waitUntilConnected()
      this.client?.subscribe(resultTopic)
    } catch (error) {
      this.calibrationResultSubscriptions.delete(normalizedUuid)
      this.uuidByTopic.delete(resultTopic)
      throw error
    }
  }

  async retainSubscription(uuid: string) {
    const normalizedUuid = uuid.trim()
    if (!normalizedUuid) {
      throw new Error("UUID is required to subscribe to gyro telemetry.")
    }

    const existing = this.subscriptionsByUuid.get(normalizedUuid)
    if (existing) {
      existing.refCount += 1
      await this.retainCalibrationResultSubscription(normalizedUuid)
      return () => this.releaseSubscription(normalizedUuid)
    }

    const topic = buildGyroTopic(normalizedUuid)
    const subscription: TopicSubscription = {
      uuid: normalizedUuid,
      topic,
      refCount: 1,
    }

    this.subscriptionsByUuid.set(normalizedUuid, subscription)
    this.uuidByTopic.set(topic, normalizedUuid)

    try {
      await this.waitUntilConnected()
      this.client?.subscribe(topic)
      await this.retainCalibrationResultSubscription(normalizedUuid)
    } catch (error) {
      this.subscriptionsByUuid.delete(normalizedUuid)
      this.uuidByTopic.delete(topic)
      throw error
    }

    return () => this.releaseSubscription(normalizedUuid)
  }

  private releaseSubscription(uuid: string) {
    const subscription = this.subscriptionsByUuid.get(uuid)
    if (!subscription) return

    subscription.refCount -= 1
    if (subscription.refCount > 0) return

    this.subscriptionsByUuid.delete(uuid)
    this.uuidByTopic.delete(subscription.topic)
    this.client?.unsubscribe(subscription.topic)
  }

  latestReading(uuid: string) {
    return this.latestReadings.get(uuid.trim()) ?? null
  }

  async awaitSnapshot(uuid: string, timeoutMs: number) {
    const normalizedUuid = uuid.trim()
    const requestTimestamp = Date.now()
    const release = await this.retainSubscription(normalizedUuid)
    const topic = buildGyroTopic(normalizedUuid)

    try {
      const latest = this.latestReading(normalizedUuid)
      if (latest && requestTimestamp - latest.timestamp <= 150) {
        return latest
      }

      const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1000

      return await new Promise<GyroReading>((resolve) => {
        const waiters = this.waitersByUuid.get(normalizedUuid) ?? new Set<GyroWaiter>()
        const waiter: GyroWaiter = {
          minTimestamp: requestTimestamp,
          resolve,
          reject: () => {},
          timeout: setTimeout(() => {
            waiters.delete(waiter)
            if (waiters.size === 0) {
              this.waitersByUuid.delete(normalizedUuid)
            }
            resolve(this.buildZeroGyroReading(topic))
          }, safeTimeoutMs),
        }

        waiters.add(waiter)
        this.waitersByUuid.set(normalizedUuid, waiters)
      })
    } catch {
      return this.buildZeroGyroReading(topic)
    } finally {
      release()
    }
  }

  async startCalibrationCapture(uuid: string, payload: CalibrationRecordStartPayload) {
    const normalizedUuid = uuid.trim()
    if (!normalizedUuid) {
      throw new Error("UUID is required to start calibration capture.")
    }

    await this.retainCalibrationResultSubscription(normalizedUuid)

    const captureId = randomUUID()
    const acceptedAt = Date.now()
    const controlTopic = buildCalibrationControlTopic(normalizedUuid)
    const resultTopic = buildCalibrationResultTopic(normalizedUuid)
    const record: CalibrationCaptureRecord = {
      uuid: normalizedUuid,
      captureId,
      pointIndex: payload.pointIndex,
      target: payload.target,
      durationMs: payload.durationMs,
      startedAt: payload.startedAt,
      acceptedAt,
      controlTopic,
      resultTopic,
    }

    this.pendingCaptures.set(this.captureKey(normalizedUuid, captureId), record)

    await this.waitUntilConnected()

    await new Promise<void>((resolve, reject) => {
      this.client?.publish(
        controlTopic,
        JSON.stringify({
          kind: "calibration-record-start",
          uuid: normalizedUuid,
          captureId,
          pointIndex: payload.pointIndex,
          target: {
            x: payload.target[0],
            y: payload.target[1],
          },
          durationMs: payload.durationMs,
          startedAt: payload.startedAt,
          acceptedAt,
          resultTopic,
        }),
        (error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        },
      )
    })

    return {
      captureId,
      pointIndex: payload.pointIndex,
      durationMs: payload.durationMs,
      acceptedAt,
      controlTopic,
    }
  }

  async awaitCalibrationCaptureResult(uuid: string, captureId: string, timeoutMs: number) {
    const normalizedUuid = uuid.trim()
    const normalizedCaptureId = captureId.trim()
    const key = this.captureKey(normalizedUuid, normalizedCaptureId)
    const existing = this.captureResults.get(key)
    if (existing) {
      return existing
    }

    const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : gazeConfig.calibrationCaptureResultTimeoutMs

    return await new Promise<CalibrationCaptureResult>((resolve, reject) => {
      const waiters = this.captureWaiters.get(key) ?? new Set<CalibrationResultWaiter>()
      const waiter: CalibrationResultWaiter = {
        resolve: (result) => {
          resolve(result)
        },
        reject,
        timeout: setTimeout(() => {
          waiters.delete(waiter)
          if (waiters.size === 0) {
            this.captureWaiters.delete(key)
          }
          reject(new Error("Timed out while waiting for the face-pose calibration result."))
        }, safeTimeoutMs),
      }

      waiters.add(waiter)
      this.captureWaiters.set(key, waiters)
    })
  }

  getPendingCapture(uuid: string, captureId: string) {
    return this.pendingCaptures.get(this.captureKey(uuid, captureId)) ?? null
  }

  clearPendingCapture(uuid: string, captureId: string) {
    const key = this.captureKey(uuid, captureId)
    this.pendingCaptures.delete(key)
    this.captureResults.delete(key)
  }

  close() {
    this.connected = false
    for (const waiters of this.waitersByUuid.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout)
        waiter.reject(new Error("MQTT bridge was closed."))
      }
    }

    for (const waiters of this.captureWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout)
        waiter.reject(new Error("MQTT bridge was closed."))
      }
    }

    this.waitersByUuid.clear()
    this.captureWaiters.clear()
    this.latestReadings.clear()
    this.subscriptionsByUuid.clear()
    this.calibrationResultSubscriptions.clear()
    this.pendingCaptures.clear()
    this.captureResults.clear()
    this.uuidByTopic.clear()

    this.client?.end(true)
    this.client = null
  }
}

export const gazeMqttBridge = new GazeMqttBridge()
