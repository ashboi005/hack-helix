import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { gazeVector, type GazeSession, type GazeTrackingInput, type GazeVectorReturn } from "@/lib/gaze/gaze-core"
import {
  type TestCalibrationData,
  type TestCalibrationPoint,
  testEyeTrackerStorage,
} from "@/lib/gaze/gaze-core-widget-storage"
import type {
  EyeCornerSelection,
  FrameState,
  LiveResult,
  RoiDrag,
  RoiRect,
  Step,
  TestCalibrationResult,
} from "./types"
import { STEPS } from "./types"
import {
  buildCalibrationGrid,
  clampValue,
  drawEyeCornerSelectionOverlay,
  drawEyeModelOverlay,
  drawFrame,
  drawGazeOverlay,
  drawRoiOverlay,
  drawThresholdMask,
  modeVector,
  normalizeGazeVector,
  toPreviewGazeData,
} from "./utils"

export function useTestEyeTracker() {
  const savedPrefs = testEyeTrackerStorage.readPrefs()
  const savedCalibration = testEyeTrackerStorage.readCalibration()

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
  const [calibrating, setCalibrating] = useState(false)
  const [calibIndex, setCalibIndex] = useState(0)
  const [calibrationGrid, setCalibrationGrid] = useState<[number, number][]>([])
  const [latestResult, setLatestResult] = useState<LiveResult | null>(null)
  const [calibrationResult, setCalibrationResult] = useState<TestCalibrationResult>({
    data: savedCalibration,
    record: savedCalibration
      ? {
        calibration: savedCalibration,
        neutralSnapshot: savedCalibration.neutralSnapshot ?? savedCalibration.points[0]?.facePoseBaseline ?? null,
      }
      : null,
    neutralSnapshot: savedCalibration?.neutralSnapshot ?? savedCalibration?.points[0]?.facePoseBaseline ?? null,
    rawJson: savedCalibration ? JSON.stringify(savedCalibration, null, 2) : "",
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

      const session = gazeVector(buildTrackingInput(), (result: GazeVectorReturn) => {
        frameStateRef.current = {
          gazeData: toPreviewGazeData(result),
          thresholdMask: result.iPupilDetectionReturn.thresholdPreview,
          roi: result.roi,
          frameSize: null,
        }
        setLatestResult(result)
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
      setEyeCorners((prev) => ({ ...prev, [target]: rounded }))
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
        setEyeCorners((prev) => ({ ...prev, [target]: rounded }))
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

    setRoi((prev) => {
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

  function startCalibration() {
    setCalibrationGrid(buildCalibrationGrid(window.innerWidth, window.innerHeight))
    savedPointsRef.current = []
    captureSamplesRef.current = []
    setCalibIndex(0)
    setCalibrating(true)
  }

  function stopCalibration() {
    setCalibrating(false)
    setCaptureActive(false)
    setCaptureProgress(0)
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
    if (captureProgressRef.current) clearInterval(captureProgressRef.current)
    captureTimerRef.current = null
    captureProgressRef.current = null
    captureSamplesRef.current = []
  }

  function capturePoint() {
    if (!previewActive || captureActive || !calibrating) return

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
      if (captureProgressRef.current) clearInterval(captureProgressRef.current)
      captureTimerRef.current = null
      captureProgressRef.current = null

      const samples = captureSamplesRef.current
      captureSamplesRef.current = []
      setCaptureActive(false)
      setCaptureProgress(0)

      const mostCommonVector = modeVector(samples)
      if (!mostCommonVector) return

      const point = calibrationGrid[calibIndex]
      const fallbackTimestamp = Date.now()
      savedPointsRef.current.push({
        screen: point,
        gaze: mostCommonVector,
        facePoseBaseline: {
          x: 0,
          y: 0,
          z: 0,
          yaw: 0,
          pitch: 0,
          roll: 0,
          timestamp: fallbackTimestamp,
          source: "legacy-preview",
          kind: "legacy-gyro",
          sampleCount: 0,
          startedAt: fallbackTimestamp,
          endedAt: fallbackTimestamp,
          confidence: 0,
          quality: 0,
        },
        gazeSampleCount: samples.length,
        faceSampleCount: 0,
        captureId: `legacy-preview-${calibIndex}`,
        capturedAt: fallbackTimestamp,
        quality: 0,
      })

      const nextIndex = calibIndex + 1
      if (nextIndex >= calibrationGrid.length) {
        const data: TestCalibrationData = {
          version: 2,
          createdAt: Date.now(),
          screen: { width: window.innerWidth, height: window.innerHeight },
          points: savedPointsRef.current,
          neutralSnapshot: savedPointsRef.current[0]?.facePoseBaseline ?? null,
        }
        testEyeTrackerStorage.writeCalibration(data)
        setCalibrationResult({
          data,
          record: {
            calibration: data,
            neutralSnapshot: data.neutralSnapshot ?? null,
          },
          neutralSnapshot: data.neutralSnapshot ?? null,
          rawJson: JSON.stringify(data, null, 2),
        })
        stopCalibration()
        return
      }

      setCalibIndex(nextIndex)
    }, durationMs)
  }

  function clearCalibration() {
    setCalibrationResult({ data: null, record: null, neutralSnapshot: null, rawJson: "" })
    localStorage.removeItem("gaze-core-test-calibration")
  }

  const stepIndex = STEPS.indexOf(currentStep)
  const calibPoint = calibrating ? calibrationGrid[calibIndex] ?? null : null

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
    captureActive,
    captureProgress,
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
    clearCalibration,
  }
}
