import { normalizeConfig } from "./constants"
import { detectGlint, detectPupil } from "./detection"
import { driftCenter, gazeVector3D, resolveEyeGeometry } from "./geometry"
import { equalize, toGray } from "./image"
import { clamp, odd, smooth } from "./math"
import { normalizeEyeCorners, normalizeRoi } from "./roi"
import { usbConstraints, waitForVideo } from "./source"
import type {
  Config,
  Ellipse,
  GazeListener,
  GazePupilDetectionReturn,
  GazeSession,
  GazeTrackingInput,
  GazeTrackingUpdate,
  GazeVectorReturn,
  IPupilDetectionReturn,
  Mode,
  Point,
  PupilEllipse,
  Vector3,
} from "./types"

export class Runtime<T> implements GazeSession<T> {
  private readonly mode: Mode
  private config: Config
  private readonly listeners = new Set<GazeListener<T>>()
  private latest: T | null = null
  private running = false
  private raf = 0
  private lastFrame = 0
  private smoothed: Vector3 = [0, 0, 1]
  private readonly recentPupilFits: Array<{ key: string; ellipse: Ellipse; center: Point; score: number }> = []

  private readonly video: HTMLVideoElement
  private ownVideo = false
  private stream: MediaStream | null = null

  private readonly canvas = document.createElement("canvas")
  private readonly ctx = this.canvas.getContext("2d", { willReadFrequently: true })

  constructor(mode: Mode, input: GazeTrackingInput) {
    if (!this.ctx) throw new Error("Unable to initialize canvas context")
    this.mode = mode
    this.config = normalizeConfig(input)

    if (this.config.videoElement) {
      this.video = this.config.videoElement
    } else {
      this.video = document.createElement("video")
      this.video.autoplay = true
      this.video.muted = true
      this.video.playsInline = true
      this.video.style.display = "none"
      this.ownVideo = true
      if (typeof document !== "undefined" && document.body) document.body.appendChild(this.video)
    }
  }

  async start(): Promise<void> {
    if (this.running) return
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      throw new Error("Camera APIs are not available in this environment")
    }
    await this.openSource()
    this.running = true
    this.lastFrame = 0
    this.raf = requestAnimationFrame(this.loop)
  }

  stop(): void {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0

    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    if (this.video.srcObject) this.video.srcObject = null
    if (this.video.src) {
      this.video.removeAttribute("src")
      this.video.load()
    }
    if (this.ownVideo && this.video.parentElement) this.video.parentElement.removeChild(this.video)
    this.smoothed = [0, 0, 1]
    this.recentPupilFits.length = 0
  }

  update(next: GazeTrackingUpdate): void {
    if (next.roi !== undefined) this.config.roi = next.roi
    if (next.eyeCorners) this.config.eyeCorners = next.eyeCorners
    if (typeof next.threshold === "number") this.config.threshold = clamp(next.threshold, 10, 200)
    if (typeof next.pupilBlur === "number") this.config.pupilBlur = odd(next.pupilBlur, 3)
    if (typeof next.glintThreshold === "number") this.config.glintThreshold = clamp(next.glintThreshold, 1, 255)
    if (typeof next.glintBlur === "number") this.config.glintBlur = odd(next.glintBlur, 1)
    if (typeof next.smoothingFactor === "number") this.config.smoothingFactor = clamp(next.smoothingFactor, 0.01, 0.5)
    if (typeof next.sphereRadius === "number") this.config.sphereRadius = Math.max(50, next.sphereRadius)
    if (typeof next.fps === "number") this.config.fps = clamp(next.fps, 1, 120)
  }

  isRunning(): boolean {
    return this.running
  }

  subscribe(listener: GazeListener<T>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getLatest(): T | null {
    return this.latest
  }

  getVideoElement(): HTMLVideoElement {
    return this.video
  }

  private loop = (t: number): void => {
    if (!this.running) return
    const interval = 1000 / this.config.fps
    if (t - this.lastFrame >= interval) {
      this.lastFrame = t
      this.process()
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private async openSource(): Promise<void> {
    const src = this.config.cameraSource
    if (src.kind === "usb") {
      const constraints = await usbConstraints(src)
      this.stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false })
      this.video.srcObject = this.stream
      await this.video.play().catch(() => undefined)
      await waitForVideo(this.video)
      return
    }

    this.video.srcObject = null
    this.video.crossOrigin = src.crossOrigin ?? "anonymous"
    this.video.src = src.source
    await waitForVideo(this.video)
    await this.video.play().catch(() => undefined)
  }

  private emit(value: T): void {
    this.latest = value
    for (const cb of this.listeners) cb(value)
  }

  private process(): void {
    const width = this.video.videoWidth
    const height = this.video.videoHeight
    if (width <= 1 || height <= 1) return
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    this.ctx!.drawImage(this.video, 0, 0, width, height)

    const roi = normalizeRoi(this.config.roi, width, height)
    const eyeCorners = normalizeEyeCorners(this.config.eyeCorners)
    const frame = this.ctx!.getImageData(roi.x, roi.y, roi.width, roi.height)
    const gray = toGray(frame.data)
    const equalized = equalize(gray)

    const [eyeCenter, radius, localCorners] = resolveEyeGeometry(
      eyeCorners,
      [roi.x, roi.y],
      roi.width,
      roi.height,
      this.config.sphereRadius,
    )

    const detection = detectPupil(
      equalized,
      roi.width,
      roi.height,
      [Math.round(eyeCenter[0]), Math.round(eyeCenter[1])],
      this.config.pupilBlur,
      this.config.threshold,
    )
    const stabilized = this.stabilizePupilFit(
      detection.pupilEllipse,
      detection.pupilCenter,
      detection.score >= 0 ? detection.score : 0,
    )

    const glint = detectGlint(
      gray,
      roi.width,
      roi.height,
      this.config.glintBlur,
      this.config.glintThreshold,
    )

    const pupilCenterLocal = stabilized.center
    const pupilEllipseLocal = stabilized.ellipse
    const dynamicCenter = driftCenter(eyeCenter, pupilCenterLocal, 0.18)
    let screenPosition: Point | null = null
    if (pupilCenterLocal) {
      const fresh = gazeVector3D(pupilCenterLocal, eyeCenter, radius)
      this.smoothed = smooth(this.smoothed, fresh, this.config.smoothingFactor)
      screenPosition = [pupilCenterLocal[0] + roi.x, pupilCenterLocal[1] + roi.y]
    }

    const pupilCenterGlobal = pupilCenterLocal
      ? ([pupilCenterLocal[0] + roi.x, pupilCenterLocal[1] + roi.y] as Point)
      : null
    const pupilEllipse: PupilEllipse | null = pupilEllipseLocal
      ? {
          center: [pupilEllipseLocal.center[0] + roi.x, pupilEllipseLocal.center[1] + roi.y],
          axes: pupilEllipseLocal.axes,
          angle: pupilEllipseLocal.angle,
          score: detection.score >= 0 ? detection.score : 0,
        }
      : null
    const pupilCircle = pupilEllipse
      ? {
          center: pupilEllipse.center,
          axes: [
            (pupilEllipse.axes[0] + pupilEllipse.axes[1]) * 0.5,
            (pupilEllipse.axes[0] + pupilEllipse.axes[1]) * 0.5,
          ] as [number, number],
          angle: 0,
        }
      : null

    const iPupilDetectionReturn: IPupilDetectionReturn = {
      pupilCenter: pupilCenterLocal,
      pupilCenterGlobal,
      pupilEllipse,
      pupilMask: { width: roi.width, height: roi.height, data: detection.pupilMask.slice() },
      thresholdPreview: { width: roi.width, height: roi.height, data: detection.thresholdPreview.slice() },
      score: detection.score >= 0 ? detection.score : null,
    }

    if (this.mode === "vector") {
      const output: GazeVectorReturn = {
        timestamp: Date.now() / 1000,
        gazeVector: [...this.smoothed] as Vector3,
        iPupilDetectionReturn,
        pupilSphereEllipse: pupilEllipse,
        pupilCircle,
        insiderPupilValue: pupilCenterGlobal,
        screenPosition,
        frameSize: { width: roi.width, height: roi.height },
        roi,
        glintCenter: glint ? [glint[0] + roi.x, glint[1] + roi.y] : null,
        eyeModel: {
          center: [eyeCenter[0] + roi.x, eyeCenter[1] + roi.y],
          dynamic_center: [dynamicCenter[0] + roi.x, dynamicCenter[1] + roi.y],
          radius,
          corners: {
            inner: [localCorners[0][0] + roi.x, localCorners[0][1] + roi.y],
            outer: [localCorners[1][0] + roi.x, localCorners[1][1] + roi.y],
          },
        },
      }
      this.emit(output as T)
      return
    }

    const output: GazePupilDetectionReturn = {
      timestamp: Date.now() / 1000,
      iPupilDetectionReturn,
      pupilCircle,
      insiderPupilValue: pupilCenterGlobal,
      frameSize: { width: roi.width, height: roi.height },
      roi,
    }
    this.emit(output as T)
  }

  private stabilizePupilFit(
    ellipse: Ellipse | null,
    center: Point | null,
    score: number,
  ): { ellipse: Ellipse | null; center: Point | null } {
    if (ellipse && center) {
      const radius = (ellipse.axes[0] + ellipse.axes[1]) * 0.5
      const key = [
        Math.round(center[0] / 2),
        Math.round(center[1] / 2),
        Math.round(radius / 2),
      ].join(",")
      this.recentPupilFits.push({
        key,
        ellipse,
        center,
        score,
      })
      if (this.recentPupilFits.length > 5) this.recentPupilFits.shift()
    }

    if (this.recentPupilFits.length === 0) {
      return { ellipse, center }
    }

    const buckets = new Map<string, { count: number; best: { ellipse: Ellipse; center: Point; score: number } }>()
    for (const sample of this.recentPupilFits) {
      const existing = buckets.get(sample.key)
      if (existing) {
        existing.count += 1
        if (sample.score >= existing.best.score) {
          existing.best = {
            ellipse: sample.ellipse,
            center: sample.center,
            score: sample.score,
          }
        }
      } else {
        buckets.set(sample.key, {
          count: 1,
          best: {
            ellipse: sample.ellipse,
            center: sample.center,
            score: sample.score,
          },
        })
      }
    }

    let bestBucket: { count: number; best: { ellipse: Ellipse; center: Point; score: number } } | null = null
    for (const bucket of buckets.values()) {
      if (
        !bestBucket
        || bucket.count > bestBucket.count
        || (bucket.count === bestBucket.count && bucket.best.score >= bestBucket.best.score)
      ) {
        bestBucket = bucket
      }
    }

    return bestBucket
      ? {
          ellipse: bestBucket.best.ellipse,
          center: bestBucket.best.center,
        }
      : { ellipse, center }
  }
}
