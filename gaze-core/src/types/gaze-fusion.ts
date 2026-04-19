import type { CalibrationPayload, GyroReading, Vector3 } from "@/lib/gaze-types";

export type Point2D = {
  x: number;
  y: number;
};

export type GyroScale = {
  pixelsPerYawDegree: number;
  pixelsPerPitchDegree: number;
  pixelsPerRollDegree: number;
};

export type MotionDelta = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
};

export type SolveGazePointInput = {
  calibration: CalibrationPayload;
  gazeVector: Vector3;
  zeroSnapshot: GyroReading;
  currentGyro: GyroReading;
  previousPoint?: Point2D | null;
};
