"use client"
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { gazeVector, type GazeSession, type GazeTrackingInput, type GazeVectorReturn } from "@/lib/gaze/gaze-core"
import {
  type TestCalibrationData,
  type TestCalibrationPoint,
  type TestCalibrationRecord,
  testEyeTrackerStorage,
} from "../../lib/gaze/gaze-core-widget-storage"
import { buildGyroSnapshotRouteUrl, buildLivePreviewSocketUrl } from "../../lib/gaze/gaze-core-widget-backend/routes"
import { GazeWidgetTokenManager } from "../../lib/gaze/gaze-core-widget-backend/token-manager"
import type { GyroSnapshot } from "../../lib/gaze/gaze-core-widget-backend/types"
import { connectLivePreviewSocket, WebSocketAuthorizationError } from "../../lib/gaze/gaze-core-widget-backend/websocket"
import { exitFullscreenSafely, requestFullscreenSafely } from "../../lib/gaze/gaze-core-widget-fullscreen"
import type {
  EyeCornerSelection,
  FrameState,
  LiveResult,
  RoiDrag,
  RoiRect,
  Step,
  TestCalibrationResult,
} from "../../lib/gaze/gaze-core-widget-types"
import { STEPS } from "../../lib/gaze/gaze-core-widget-types"
import {
  buildCalibrationGrid,
  clampValue,
  drawEyeCornerSelectionOverlay,
  drawEyeModelOverlay,
  drawFrame,
  drawGazeOverlay,
  drawRoiOverlay,
  drawThresholdMask,
  getCalibrationTargetTransform,
  modeVector,
  normalizeGazeVector,
  toPreviewGazeData,
} from "../../lib/gaze/gaze-core-widget-utils"

export type GazeCoreWidgetOptions = {
  onLiveResult?: (result: LiveResult | null) => void
  onCalibrationComplete?: (data: TestCalibrationData) => void
  onCalibrationRecordReady?: (record: TestCalibrationRecord) => void
  backendBaseUrl?: string
  apiKey?: string
  deviceUuid?: string
  livePreviewSocketUrl?: string
  livePreviewToken?: string
  onLivePreviewPoint?: (point: LivePreviewPoint | null) => void
}

export type LivePreviewConnectionStatus = "idle" | "connecting" | "connected" | "error"
export type LivePreviewPoint = { x: number; y: number; timestamp: number }

export function useGazeCoreSetupWidget(options: GazeCoreWidgetOptions = {}) {
  const savedPrefs = testEyeTrackerStorage.readPrefs()
  const savedCalibrationRecord = testEyeTrackerStorage.readCalibrationRecord()
  const savedCalibration = savedCalibrationRecord?.calibration ?? null

  const [currentStep, setCurrentStep] = useState<Step>("source")
  const [kind, setKind] = useState<"usb" | "network">(savedPrefs.kind)
  const [source, setSource] = useState(savedPrefs.source)
  const [roi, setRoi] = useState<RoiRect>(savedPrefs.roi)
  const [eyeCorners, setEyeCorners] = useState<EyeCornerSelection>(savedPrefs.eyeCorners)
  const [eyeCornerTarget, setEyeCornerTarget] = useState<"inner" | "outer">("inner")
  const [pupilThreshold, setPupilThreshold] = useState(savedPrefs.parameters.pupilThreshold)
  const [pupilBlur, setPupilBlur] = useState(savedPrefs.parameters.pupilBlur)
  const [previewActive, setPreviewActive] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [captureActive, setCaptureActive] = useState(false)
  const [captureProgress, setCaptureProgress] = useState(0)
  const [calibrationStatusText, setCalibrationStatusText] = useState("")
  const [calibrationError, setCalibrationError] = useState("")
  const [gyroSnapshotPending, setGyroSnapshotPending] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [calibIndex, setCalibIndex] = useState(0)
  const [calibrationGrid, setCalibrationGrid] = useState<[number, number][]>([])
  const [calibrationViewport, setCalibrationViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  }))
  const [latestResult, setLatestResult] = useState<LiveResult | null>(null)
  const [livePreviewActive, setLivePreviewActive] = useState(false)
  const [livePreviewStatus, setLivePreviewStatus] = useState<LivePreviewConnectionStatus>("idle")
  const [livePreviewPoint, setLivePreviewPoint] = useState<LivePreviewPoint | null>(null)
  const [livePreviewError, setLivePreviewError] = useState("")
  const [calibrationResult, setCalibrationResult] = useState<TestCalibrationResult>({
    data: savedCalibration,
    record: savedCalibrationRecord,
    gyroZeroSnapshot: savedCalibrationRecord?.gyroZeroSnapshot ?? null,
    rawJson: savedCalibrationRecord ? JSON.stringify(savedCalibrationRecord, null, 2) : "",
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const thresholdCanvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<GazeSession<GazeVectorReturn> | null>(null)
  const frameStateRef = useRef<FrameState>({
    gazeData: null,
    thresholdMask: null,
    roi: null,
    frameSize: null,
  })
  const renderRafRef = useRef(0)
  const currentStepRef = useRef<Step>(currentStep)
  const roiRef = useRef(roi)
  const eyeCornersRef = useRef<EyeCornerSelection>(eyeCorners)
  const roiDragRef = useRef<RoiDrag>({ active: false, handleIndex: -1 })
  const cornerDragRef = useRef<{ active: boolean; target: "inner" | "outer" | null }>({
    active: false,
    target: null,
  })
  const captureSamplesRef = useRef<[number, number, number][]>([])
  const savedPointsRef = useRef<TestCalibrationPoint[]>([])
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureProgressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const livePreviewSocketRef = useRef<WebSocket | null>(null)
  const livePreviewActiveRef = useRef(false)
  const livePreviewSendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const livePreviewPingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const latestLivePreviewResultRef = useRef<GazeVectorReturn | null>(null)
  const calibrationRecordRef = useRef<TestCalibrationRecord | null>(savedCalibrationRecord)
  const calibrationViewportRef = useRef(calibrationViewport)
  const onLivePreviewPointRef = useRef(options.onLivePreviewPoint)
  const tokenManagerRef = useRef(new GazeWidgetTokenManager())
  const fullscreenOwnedRef = useRef(false)

  useEffect(() => {
    currentStepRef.current = currentStep
  }, [currentStep])

  useEffect(() => {
    roiRef.current = roi
  }, [roi])

  useEffect(() => {
    eyeCornersRef.current = eyeCorners
  }, [eyeCorners])

  useEffect(() => {
    livePreviewActiveRef.current = livePreviewActive
  }, [livePreviewActive])

  useEffect(() => {
    calibrationRecordRef.current = calibrationResult.record
  }, [calibrationResult.record])

  useEffect(() => {
    calibrationViewportRef.current = calibrationViewport
  }, [calibrationViewport])

  useEffect(() => {
    onLivePreviewPointRef.current = options.onLivePreviewPoint
    tokenManagerRef.current.updateConfig({
      backendBaseUrl: options.backendBaseUrl,
      apiKey: options.apiKey,
      deviceUuid: options.deviceUuid,
      initialToken: options.livePreviewToken,
    })
  }, [
    options.apiKey,
    options.backendBaseUrl,
    options.deviceUuid,
    options.livePreviewSocketUrl,
    options.livePreviewToken,
    options.onLivePreviewPoint,
  ])

  useEffect(() => {
    testEyeTrackerStorage.writePrefs({
      kind,
      source,
      roi,
      eyeCorners,
      parameters: { pupilThreshold, pupilBlur },
    })
  }, [kind, source, roi, eyeCorners, pupilThreshold, pupilBlur])

  useEffect(() => {
    if (!previewActive) return
    pushUpdate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roi, eyeCorners, pupilThreshold, pupilBlur])

  useEffect(() => {
    return () => {
      closePreview()
    }
  }, [])

  useEffect(() => {
    if (livePreviewSendIntervalRef.current) {
      clearInterval(livePreviewSendIntervalRef.current)
      livePreviewSendIntervalRef.current = null
    }

    if (!livePreviewActive || livePreviewStatus !== "connected") return

    livePreviewSendIntervalRef.current = setInterval(() => {
      sendLivePreviewGaze()
    }, 50)

    return () => {
      if (livePreviewSendIntervalRef.current) {
        clearInterval(livePreviewSendIntervalRef.current)
        livePreviewSendIntervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePreviewActive, livePreviewStatus])

  useEffect(() => {
    if (livePreviewPingIntervalRef.current) {
      clearInterval(livePreviewPingIntervalRef.current)
      livePreviewPingIntervalRef.current = null
    }

    if (!livePreviewActive || livePreviewStatus !== "connected") return

    livePreviewPingIntervalRef.current = setInterval(() => {
      sendLivePreviewPing()
    }, 10000)

    return () => {
      if (livePreviewPingIntervalRef.current) {
        clearInterval(livePreviewPingIntervalRef.current)
        livePreviewPingIntervalRef.current = null
      }
    }
  }, [livePreviewActive, livePreviewStatus])

  useEffect(() => {
    if (!calibrating) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space") {
        event.preventDefault()
        capturePoint()
      }
      if (event.code === "Escape") {
        stopCalibration()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrating, calibIndex, captureActive])

  useEffect(() => {
    if (!calibrating) return

    const { documentElement, body } = document
    const previousHtmlOverflow = documentElement.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth

    documentElement.style.overflow = "hidden"
    body.style.overflow = "hidden"
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      documentElement.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
      body.style.paddingRight = previousBodyPaddingRight
    }
  }, [calibrating])

  function buildCalibrationRecord(
    calibration: TestCalibrationData,
    gyroZeroSnapshot: GyroSnapshot | null,
  ): TestCalibrationRecord {
    return {
      calibration,
      gyroZeroSnapshot,
    }
  }

  function applyCalibrationRecord(record: TestCalibrationRecord | null) {
    if (!record) {
      testEyeTrackerStorage.clearCalibrationRecord()
      calibrationRecordRef.current = null
      setCalibrationResult({
        data: null,
        record: null,
        gyroZeroSnapshot: null,
        rawJson: "",
      })
      return
    }

    testEyeTrackerStorage.writeCalibrationRecord(record)
    setCalibrationResult({
      data: record.calibration,
      record,
      gyroZeroSnapshot: record.gyroZeroSnapshot,
      rawJson: JSON.stringify(record, null, 2),
    })
    calibrationRecordRef.current = record
  }

  function resolveLivePreviewSocketUrl() {
    if (!options.backendBaseUrl && !options.livePreviewSocketUrl) return ""
    return buildLivePreviewSocketUrl(options.backendBaseUrl, options.livePreviewSocketUrl)
  }

  async function captureGyroZeroSnapshot() {
    const calibrationData = calibrationRecordRef.current?.calibration ?? calibrationResult.data
    if (!calibrationData) {
      throw new Error("Run the 9-point calibration before capturing the gyro zero snapshot.")
    }

    if (!options.backendBaseUrl?.trim()) {
      throw new Error("A backend base URL is required to capture the gyro zero snapshot.")
    }

    setCalibrationError("")
    setCalibrationStatusText("Capturing gyro zero snapshot...")
    setGyroSnapshotPending(true)

    try {
      const response = await tokenManagerRef.current.authorizedFetch(async (token) =>
        fetch(buildGyroSnapshotRouteUrl(options.backendBaseUrl), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null
        const message = typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.error === "string"
            ? payload.error
            : "Unable to capture the gyro zero snapshot."

        throw new Error(message)
      }

      const payload = await response.json() as {
        snapshot?: GyroSnapshot
      }

      if (!payload.snapshot) {
        throw new Error("The backend returned an empty gyro zero snapshot.")
      }

      const record = buildCalibrationRecord(calibrationData, payload.snapshot)
      applyCalibrationRecord(record)
      options.onCalibrationRecordReady?.(record)
      setCalibrationStatusText("")
      return payload.snapshot
    } finally {
      setGyroSnapshotPending(false)
    }
  }

  function hasTokenAuthorizationConfig() {
    return tokenManagerRef.current.canAuthorize()
  }

  function hasGyroSnapshotRequirements() {
    return Boolean(options.backendBaseUrl?.trim()) && hasTokenAuthorizationConfig()
  }

  function hasLivePreviewSocketRoute() {
    return Boolean(resolveLivePreviewSocketUrl())
  }

  function hasLivePreviewRequirements() {
    return hasLivePreviewSocketRoute() && hasTokenAuthorizationConfig()
  }

  function canStartLivePreview() {
    return (
      hasLivePreviewRequirements()
      && Boolean(calibrationResult.data)
      && Boolean(calibrationResult.gyroZeroSnapshot)
      && previewActive
      && Boolean(sessionRef.current)
    )
  }

  function closeLivePreviewSocket() {
    const socket = livePreviewSocketRef.current
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
    livePreviewSocketRef.current = null
  }

  function clearLivePreviewIntervals() {
    if (livePreviewSendIntervalRef.current) {
      clearInterval(livePreviewSendIntervalRef.current)
      livePreviewSendIntervalRef.current = null
    }
    if (livePreviewPingIntervalRef.current) {
      clearInterval(livePreviewPingIntervalRef.current)
      livePreviewPingIntervalRef.current = null
    }
  }

  function parseLivePreviewPoint(payload: unknown): LivePreviewPoint | null {
    if (!payload || typeof payload !== "object") return null
    const record = payload as Record<string, unknown>
    const envelope = record.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : record
    const nested = envelope.coordinates
    const xRaw = typeof record.x === "number"
      ? record.x
      : typeof record.mouseX === "number"
        ? record.mouseX
        : typeof envelope.x === "number"
          ? envelope.x
          : typeof envelope.mouseX === "number"
            ? envelope.mouseX
            : nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).x === "number"
              ? (nested as Record<string, number>).x
              : null
    const yRaw = typeof record.y === "number"
      ? record.y
      : typeof record.mouseY === "number"
        ? record.mouseY
        : typeof envelope.y === "number"
          ? envelope.y
          : typeof envelope.mouseY === "number"
            ? envelope.mouseY
            : nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).y === "number"
              ? (nested as Record<string, number>).y
              : null
    if (typeof xRaw !== "number" || typeof yRaw !== "number") return null
    return { x: xRaw, y: yRaw, timestamp: Date.now() }
  }

  function sendLivePreviewGaze(result: GazeVectorReturn | null = latestLivePreviewResultRef.current) {
    if (!livePreviewActiveRef.current) return
    if (!result) return
    const socket = livePreviewSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (!calibrationRecordRef.current?.calibration) return

    socket.send(JSON.stringify({
      type: "gaze_vector",
      gazeVector: result.gazeVector,
      pupilCenter: result.iPupilDetectionReturn.pupilCenter,
      timestamp: result.timestamp,
    }))
  }

  function sendLivePreviewPing() {
    if (!livePreviewActiveRef.current) return
    const socket = livePreviewSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return

    socket.send(JSON.stringify({
      type: "ping",
      timestamp: Date.now(),
    }))
  }

  function stopLivePreview() {
    clearLivePreviewIntervals()
    closeLivePreviewSocket()
    livePreviewActiveRef.current = false
    latestLivePreviewResultRef.current = null
    setLivePreviewActive(false)
    setLivePreviewStatus("idle")
    setLivePreviewError("")
    setLivePreviewPoint(null)
    onLivePreviewPointRef.current?.(null)
  }

  async function startLivePreview() {
    const calibrationRecord = calibrationRecordRef.current ?? calibrationResult.record

    if (!hasLivePreviewRequirements()) {
      setLivePreviewError("Live preview requires a websocket route and a valid access token or API key configuration.")
      return
    }
    if (!calibrationRecord?.calibration) {
      setLivePreviewError("Run the 9-point calibration before live preview.")
      return
    }
    if (!calibrationRecord.gyroZeroSnapshot) {
      setLivePreviewError("Capture the gyro zero snapshot before starting live preview.")
      return
    }
    if (!previewActive) {
      setLivePreviewError("Start camera preview first so gaze vectors are available.")
      return
    }

    stopLivePreview()
    livePreviewActiveRef.current = true
    setLivePreviewActive(true)
    setLivePreviewStatus("connecting")
    setLivePreviewError("")

    try {
      const socketUrl = resolveLivePreviewSocketUrl()
      let socket: WebSocket

      try {
        const firstToken = await tokenManagerRef.current.ensureToken(false)
        socket = await connectLivePreviewSocket({
          socketUrl,
          token: firstToken.token,
        })
      } catch (error) {
        if (!(error instanceof WebSocketAuthorizationError) || !tokenManagerRef.current.canIssueToken()) {
          throw error
        }

        const refreshedToken = await tokenManagerRef.current.ensureToken(true)
        socket = await connectLivePreviewSocket({
          socketUrl,
          token: refreshedToken.token,
        })
      }

      livePreviewSocketRef.current = socket
      setLivePreviewStatus("connected")
      socket.send(JSON.stringify({
        type: "session.init",
        calibration: calibrationRecord.calibration,
        gyroZeroSnapshot: calibrationRecord.gyroZeroSnapshot,
      }))

      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as unknown
          if (parsed && typeof parsed === "object") {
            const record = parsed as Record<string, unknown>
            if (record.type === "error") {
              setLivePreviewStatus("error")
              setLivePreviewError(String(record.detail ?? "Live preview websocket error."))
              return
            }
            if (record.type === "pong") {
              return
            }
          }
          const point = parseLivePreviewPoint(parsed)
          if (!point) return
          setLivePreviewPoint(point)
          onLivePreviewPointRef.current?.(point)
        } catch {
          // Ignore malformed backend messages; the stream may include non-coordinate events.
        }
      }

      socket.onerror = () => {
        setLivePreviewStatus("error")
        setLivePreviewError("Live preview websocket error.")
      }

      socket.onclose = (event) => {
        livePreviewActiveRef.current = false
        setLivePreviewActive(false)
        setLivePreviewStatus(event.code === 4401 || event.code === 4403 ? "error" : "idle")
        if (event.code === 4401 || event.code === 4403) {
          setLivePreviewError(event.reason || "The live preview websocket authorization failed.")
        }
      }
    } catch (error) {
      livePreviewActiveRef.current = false
      setLivePreviewActive(false)
      setLivePreviewStatus("error")
      setLivePreviewError(error instanceof Error ? error.message : "Failed to open live preview websocket.")
    }
  }

  function buildTrackingInput(): GazeTrackingInput {
    const currentRoi = roiRef.current
    const fallbackInner: [number, number] = [
      currentRoi.x + currentRoi.width * 0.25,
      currentRoi.y + currentRoi.height * 0.5,
    ]
    const fallbackOuter: [number, number] = [
      currentRoi.x + currentRoi.width * 0.75,
      currentRoi.y + currentRoi.height * 0.5,
    ]

    return {
      cameraSource:
        kind === "usb"
          ? { kind: "usb", source }
          : { kind: "network", source },
      roi: currentRoi,
      eyeCorners: {
        inner: eyeCornersRef.current.inner ?? fallbackInner,
        outer: eyeCornersRef.current.outer ?? fallbackOuter,
      },
      threshold: pupilThreshold,
      pupilBlur,
      fps: 20,
    }
  }

  function ensureCanvasSize(video: HTMLVideoElement) {
    const canvas = canvasRef.current
    const thresholdCanvas = thresholdCanvasRef.current
    if (!canvas || video.videoWidth <= 1 || video.videoHeight <= 1) return
    if (canvas.width !== 640 || canvas.height !== 480) {
      canvas.width = 640
      canvas.height = 480
    }
    if (thresholdCanvas && (thresholdCanvas.width !== 640 || thresholdCanvas.height !== 480)) {
      thresholdCanvas.width = 640
      thresholdCanvas.height = 480
    }
  }

  function render() {
    const session = sessionRef.current
    const video = session?.getVideoElement()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!video || !canvas || !ctx || video.videoWidth <= 1 || video.videoHeight <= 1) return

    ensureCanvasSize(video)
    drawFrame(ctx, video, video.videoWidth, video.videoHeight)

    const frame = frameStateRef.current
    const scaleX = canvas.width / video.videoWidth
    const scaleY = canvas.height / video.videoHeight
    const step = currentStepRef.current

    if (step === "roi") {
      drawRoiOverlay(ctx, roiRef.current, scaleX, scaleY, roiDragRef.current.handleIndex)
    }

    if (step === "eyeModel") {
      drawRoiOverlay(ctx, roiRef.current, scaleX, scaleY, -1)
      drawEyeCornerSelectionOverlay(ctx, eyeCornersRef.current, eyeCornerTarget, scaleX, scaleY)
    }

    if ((step === "eyeModel" || step === "thresholds" || step === "mode") && frame.gazeData) {
      drawEyeModelOverlay(ctx, frame.gazeData, scaleX, scaleY, frame.roi)
      drawGazeOverlay(ctx, frame.gazeData, scaleX, scaleY, frame.roi)
    }

    const thresholdCanvas = thresholdCanvasRef.current
    if (step === "thresholds" && thresholdCanvas) {
      const thresholdCtx = thresholdCanvas.getContext("2d")
      if (thresholdCtx) {
        drawThresholdMask(
          thresholdCtx,
          frame.thresholdMask,
          video.videoWidth,
          video.videoHeight,
          frame.roi,
        )
        if (frame.gazeData) {
          const tx = thresholdCanvas.width / video.videoWidth
          const ty = thresholdCanvas.height / video.videoHeight
          drawEyeModelOverlay(thresholdCtx, frame.gazeData, tx, ty, frame.roi)
          drawGazeOverlay(thresholdCtx, frame.gazeData, tx, ty, frame.roi)
        }
      }
    }
  }

  function startRenderLoop() {
    cancelAnimationFrame(renderRafRef.current)
    const tick = () => {
      render()
      renderRafRef.current = requestAnimationFrame(tick)
    }
    renderRafRef.current = requestAnimationFrame(tick)
  }

  async function openPreview() {
    try {
      closePreview()
      setPreviewError("")

      const session = gazeVector(buildTrackingInput(), (result) => {
        frameStateRef.current = {
          gazeData: toPreviewGazeData(result),
          thresholdMask: result.iPupilDetectionReturn.thresholdPreview,
          roi: result.roi,
          frameSize: null,
        }
        latestLivePreviewResultRef.current = result
        setLatestResult(result)
        options.onLiveResult?.(result)
        sendLivePreviewGaze(result)
        if (captureTimerRef.current) {
          const vector = normalizeGazeVector(result.gazeVector)
          if (vector) captureSamplesRef.current.push(vector)
        }
      })

      sessionRef.current = session
      await session.start()
      setPreviewActive(true)
      startRenderLoop()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start preview"
      setPreviewError(message)
      closePreview()
    }
  }

  function closePreview() {
    stopLivePreview()
    cancelAnimationFrame(renderRafRef.current)
    renderRafRef.current = 0
    sessionRef.current?.stop()
    sessionRef.current = null
    setPreviewActive(false)
  }

  function pushUpdate() {
    sessionRef.current?.update({
      roi: roiRef.current,
      eyeCorners: buildTrackingInput().eyeCorners,
      threshold: pupilThreshold,
      pupilBlur,
    })
  }

  function goToStep(step: Step) {
    setCurrentStep(step)
  }

  function getCanvasPoint(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const video = sessionRef.current?.getVideoElement()
    const width = video?.videoWidth ?? canvas.width
    const height = video?.videoHeight ?? canvas.height

    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    }
  }

  function hitTestHandle(point: { x: number; y: number }) {
    const current = roiRef.current
    const corners: [number, number][] = [
      [current.x, current.y],
      [current.x + current.width, current.y],
      [current.x, current.y + current.height],
      [current.x + current.width, current.y + current.height],
    ]

    return corners.findIndex(([cx, cy]) => Math.hypot(point.x - cx, point.y - cy) <= 14)
  }

  function hitTestEyeCorner(point: { x: number; y: number }): "inner" | "outer" | null {
    const inner = eyeCornersRef.current.inner
    const outer = eyeCornersRef.current.outer
    if (inner && Math.hypot(point.x - inner[0], point.y - inner[1]) <= 14) return "inner"
    if (outer && Math.hypot(point.x - outer[0], point.y - outer[1]) <= 14) return "outer"
    return null
  }

  function onCanvasMouseDown(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (currentStep === "eyeModel") {
      const point = getCanvasPoint(event)
      const dragTarget = hitTestEyeCorner(point)
      if (dragTarget) {
        setEyeCornerTarget(dragTarget)
        cornerDragRef.current = { active: true, target: dragTarget }
        return
      }

      const target = eyeCornerTarget
      const rounded: [number, number] = [Math.round(point.x), Math.round(point.y)]
      setEyeCorners((prev: EyeCornerSelection) => ({ ...prev, [target]: rounded }))
      setEyeCornerTarget((prev) => (prev === "inner" ? "outer" : "inner"))
      cornerDragRef.current = { active: true, target }
      return
    }

    if (currentStep !== "roi") return
    const point = getCanvasPoint(event)
    const handleIndex = hitTestHandle(point)
    if (handleIndex >= 0) {
      roiDragRef.current = { active: true, handleIndex }
    }
  }

  function onCanvasMouseMove(event: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return

    if (currentStep === "eyeModel") {
      const point = getCanvasPoint(event)
      const rounded: [number, number] = [Math.round(point.x), Math.round(point.y)]
      if (cornerDragRef.current.active && cornerDragRef.current.target) {
        const target = cornerDragRef.current.target
        setEyeCorners((prev: EyeCornerSelection) => ({ ...prev, [target]: rounded }))
      }
      canvas.style.cursor = cornerDragRef.current.active
        ? "grabbing"
        : hitTestEyeCorner(point)
          ? "grab"
          : "crosshair"
      return
    }

    if (currentStep !== "roi") return
    const point = getCanvasPoint(event)

    if (!roiDragRef.current.active) {
      const handleIndex = hitTestHandle(point)
      roiDragRef.current.handleIndex = handleIndex
      canvas.style.cursor = handleIndex >= 0 ? "crosshair" : "default"
      return
    }

    const { handleIndex } = roiDragRef.current
    const video = sessionRef.current?.getVideoElement()
    const maxWidth = video?.videoWidth ?? 640
    const maxHeight = video?.videoHeight ?? 480

    setRoi((prev: RoiRect) => {
      let { x, y, width, height } = prev

      if (handleIndex === 0) {
        const nx = clampValue(point.x, 0, x + width - 10)
        const ny = clampValue(point.y, 0, y + height - 10)
        width += x - nx
        height += y - ny
        x = nx
        y = ny
      } else if (handleIndex === 1) {
        width = clampValue(point.x - x, 10, maxWidth - x)
        const ny = clampValue(point.y, 0, y + height - 10)
        height += y - ny
        y = ny
      } else if (handleIndex === 2) {
        const nx = clampValue(point.x, 0, x + width - 10)
        width += x - nx
        x = nx
        height = clampValue(point.y - y, 10, maxHeight - y)
      } else if (handleIndex === 3) {
        width = clampValue(point.x - x, 10, maxWidth - x)
        height = clampValue(point.y - y, 10, maxHeight - y)
      }

      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      }
    })
  }

  function onCanvasMouseUp() {
    if (currentStep === "eyeModel") {
      cornerDragRef.current = { active: false, target: null }
      return
    }
    if (!roiDragRef.current.active) return
    roiDragRef.current.active = false
    pushUpdate()
  }

  async function startCalibration() {
    setCalibrationError("")
    setCalibrationStatusText("")
    fullscreenOwnedRef.current = await requestFullscreenSafely()
    stopLivePreview()

    if (!fullscreenOwnedRef.current) {
      setCalibrationStatusText("Fullscreen was blocked by the browser. Calibration will continue in the current view.")
    }

    const viewport = { width: window.innerWidth, height: window.innerHeight }
    calibrationViewportRef.current = viewport
    setCalibrationViewport(viewport)
    setCalibrationGrid(buildCalibrationGrid(viewport.width, viewport.height))
    savedPointsRef.current = []
    captureSamplesRef.current = []
    setCalibIndex(0)
    setCalibrating(true)
  }

  async function stopCalibration() {
    setCalibrating(false)
    setCaptureActive(false)
    setCaptureProgress(0)
    setCalibrationStatusText("")
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
    if (captureProgressRef.current) clearInterval(captureProgressRef.current)
    captureTimerRef.current = null
    captureProgressRef.current = null
    captureSamplesRef.current = []
    if (fullscreenOwnedRef.current) {
      fullscreenOwnedRef.current = false
      await exitFullscreenSafely()
    }
  }

  function capturePoint() {
    if (!previewActive || captureActive || !calibrating) return

    setCalibrationError("")
    setCalibrationStatusText("Capturing gaze samples...")
    setCaptureActive(true)
    setCaptureProgress(0)
    captureSamplesRef.current = []

    const durationMs = 3000
    const startedAt = Date.now()

    captureProgressRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt
      setCaptureProgress(Math.min(100, (elapsed / durationMs) * 100))
    }, 50)

    captureTimerRef.current = setTimeout(() => {
      void (async () => {
        if (captureProgressRef.current) clearInterval(captureProgressRef.current)
        captureTimerRef.current = null
        captureProgressRef.current = null

        const samples = captureSamplesRef.current
        captureSamplesRef.current = []
        setCaptureActive(false)
        setCaptureProgress(0)
        setCalibrationStatusText("")

        const mostCommonVector = modeVector(samples)
        if (!mostCommonVector) return

        const point = calibrationGrid[calibIndex]
        savedPointsRef.current.push({
          screen: point,
          gaze: mostCommonVector,
          sampleCount: samples.length,
        })

        const nextIndex = calibIndex + 1
        if (nextIndex >= calibrationGrid.length) {
          const data: TestCalibrationData = {
            version: 1,
            createdAt: Date.now(),
            screen: calibrationViewportRef.current,
            points: savedPointsRef.current,
          }
          options.onCalibrationComplete?.(data)

          const provisionalRecord = buildCalibrationRecord(data, calibrationResult.gyroZeroSnapshot ?? null)
          applyCalibrationRecord(provisionalRecord)

          try {
            await captureGyroZeroSnapshot()
          } catch (error) {
            setCalibrationError(error instanceof Error ? error.message : "Unable to capture the gyro zero snapshot.")
          }

          await stopCalibration()

          const completedRecord = calibrationRecordRef.current
          if (
            previewActive
            && Boolean(sessionRef.current)
            && Boolean(completedRecord?.calibration)
            && Boolean(completedRecord?.gyroZeroSnapshot)
          ) {
            void startLivePreview()
          }

          return
        }

        setCalibIndex(nextIndex)
      })()
    }, durationMs)
  }

  function clearCalibration() {
    stopLivePreview()
    applyCalibrationRecord(null)
    setCalibrationError("")
    setCalibrationStatusText("")
  }

  const stepIndex = STEPS.indexOf(currentStep)
  const calibPoint = calibrating ? calibrationGrid[calibIndex] ?? null : null
  const calibrationTargetTransform = calibPoint
    ? getCalibrationTargetTransform(calibPoint, calibrationViewport.width, calibrationViewport.height)
    : "translate(-50%, -50%)"
  const gyroZeroReady = Boolean(calibrationResult.gyroZeroSnapshot)
  const tokenAuthorizationReady = hasTokenAuthorizationConfig()
  const gyroSnapshotConfigured = hasGyroSnapshotRequirements()
  const livePreviewSocketRouteReady = hasLivePreviewSocketRoute()
  const livePreviewConfigured = hasLivePreviewRequirements()
  const livePreviewReady = canStartLivePreview()

  return {
    currentStep,
    stepIndex,
    steps: STEPS,
    kind,
    setKind,
    source,
    setSource,
    roi,
    setRoi,
    eyeCorners,
    eyeCornerTarget,
    setEyeCornerTarget,
    setEyeCorners,
    pupilThreshold,
    setPupilThreshold,
    pupilBlur,
    setPupilBlur,
    previewActive,
    previewError,
    latestResult,
    calibrating,
    calibIndex,
    calibPoint,
    calibrationTargetTransform,
    calibrationViewport,
    captureActive,
    captureProgress,
    calibrationStatusText,
    calibrationError,
    gyroSnapshotPending,
    calibrationResult,
    canvasRef,
    thresholdCanvasRef,
    openPreview,
    closePreview,
    pushUpdate,
    goToStep,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    startCalibration,
    stopCalibration,
    capturePoint,
    captureGyroZeroSnapshot,
    clearCalibration,
    gyroZeroReady,
    gyroSnapshotConfigured,
    tokenAuthorizationReady,
    livePreviewSocketRouteReady,
    livePreviewConfigured,
    livePreviewReady,
    livePreviewActive,
    livePreviewStatus,
    livePreviewPoint,
    livePreviewError,
    startLivePreview,
    stopLivePreview,
  }
}

export type GazeCoreSetupState = ReturnType<typeof useGazeCoreSetupWidget>



