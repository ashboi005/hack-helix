import { Runtime } from "./runtime"
import type {
  GazeListener,
  GazePupilDetectionReturn,
  GazeSession,
  GazeTrackingInput,
  GazeVectorReturn,
} from "./types"

export function gazeVector(
  input: GazeTrackingInput,
  listener?: GazeListener<GazeVectorReturn>,
): GazeSession<GazeVectorReturn> {
  const runtime = new Runtime<GazeVectorReturn>("vector", input)
  if (listener) runtime.subscribe(listener)
  return runtime
}

export function gazePupilDetection(
  input: GazeTrackingInput,
  listener?: GazeListener<GazePupilDetectionReturn>,
): GazeSession<GazePupilDetectionReturn> {
  const runtime = new Runtime<GazePupilDetectionReturn>("pupil", input)
  if (listener) runtime.subscribe(listener)
  return runtime
}

export type {
  BinaryMask,
  CameraSource,
  EyeCornersInput,
  EyeModelPayload,
  GazeListener,
  GazePupilDetectionReturn,
  GazeSession,
  GazeTrackingInput,
  GazeTrackingUpdate,
  GazeVectorReturn,
  IPupilDetectionReturn,
  Point,
  PointInput,
  PupilCircle,
  PupilEllipse,
  RoiCorners,
  RoiInput,
  RoiRect,
  Vector3,
} from "./types"
