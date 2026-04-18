export type Point = [number, number]
export type Vector3 = [number, number, number]

export type CameraSource =
  | { kind: "usb"; source?: string | number; constraints?: Omit<MediaTrackConstraints, "deviceId"> }
  | { kind: "network"; source: string; crossOrigin?: "" | "anonymous" | "use-credentials" }

export type PointInput = Point | { x: number; y: number }

export type RoiRect = {
  x: number
  y: number
  width: number
  height: number
}

export type RoiCorners = {
  topLeft: PointInput
  topRight: PointInput
  bottomRight: PointInput
  bottomLeft: PointInput
}

export type RoiInput = RoiRect | RoiCorners | [PointInput, PointInput, PointInput, PointInput]
export type EyeCornersInput = { inner: PointInput; outer: PointInput }

export type GazeTrackingInput = {
  cameraSource: CameraSource
  roi?: RoiInput
  eyeCorners: EyeCornersInput
  threshold: number
  pupilBlur?: number
  glintThreshold?: number
  glintBlur?: number
  smoothingFactor?: number
  sphereRadius?: number
  fps?: number
  videoElement?: HTMLVideoElement
}

export type GazeTrackingUpdate = Partial<Omit<GazeTrackingInput, "cameraSource" | "videoElement">>
export type BinaryMask = { width: number; height: number; data: Uint8Array }
export type PupilEllipse = { center: [number, number]; axes: [number, number]; angle: number; score: number }
export type PupilCircle = { center: [number, number]; axes: [number, number]; angle: number }

export type EyeModelPayload = {
  center: [number, number]
  dynamic_center: [number, number]
  radius: number
  corners?: { inner: [number, number]; outer: [number, number] }
}

export type IPupilDetectionReturn = {
  pupilCenter: Point | null
  pupilCenterGlobal: Point | null
  pupilEllipse: PupilEllipse | null
  pupilMask: BinaryMask
  thresholdPreview: BinaryMask
  score: number | null
}

export type GazeVectorReturn = {
  timestamp: number
  gazeVector: Vector3
  iPupilDetectionReturn: IPupilDetectionReturn
  pupilSphereEllipse: PupilEllipse | null
  pupilCircle: PupilCircle | null
  insiderPupilValue: Point | null
  screenPosition: Point | null
  frameSize: { width: number; height: number }
  roi: RoiRect
  glintCenter: Point | null
  eyeModel: EyeModelPayload
}

export type GazePupilDetectionReturn = {
  timestamp: number
  iPupilDetectionReturn: IPupilDetectionReturn
  pupilCircle: PupilCircle | null
  insiderPupilValue: Point | null
  frameSize: { width: number; height: number }
  roi: RoiRect
}

export type GazeListener<T> = (value: T) => void

export interface GazeSession<T> {
  start(): Promise<void>
  stop(): void
  update(next: GazeTrackingUpdate): void
  isRunning(): boolean
  subscribe(listener: GazeListener<T>): () => void
  getLatest(): T | null
  getVideoElement(): HTMLVideoElement
}

export type Config = {
  cameraSource: CameraSource
  roi?: RoiInput
  eyeCorners: EyeCornersInput
  threshold: number
  pupilBlur: number
  glintThreshold: number
  glintBlur: number
  smoothingFactor: number
  sphereRadius: number
  fps: number
  videoElement?: HTMLVideoElement
}

export type Mode = "vector" | "pupil"
export type Ellipse = { center: [number, number]; axes: [number, number]; angle: number }

export type Component = {
  area: number
  perimeter: number
  bbox: RoiRect
  points: number[]
  sumX: number
  sumY: number
}

export type Detection = {
  pupilCenter: Point | null
  pupilEllipse: Ellipse | null
  pupilMask: Uint8Array
  thresholdPreview: Uint8Array
  score: number
}
