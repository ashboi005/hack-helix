import type { CalibrationPayload, Vector3 } from "@/lib/gaze-types";

export type Point2D = {
  x: number;
  y: number;
};

export type SolveGazePointInput = {
  calibration: CalibrationPayload;
  gazeVector: Vector3;
  previousPoint?: Point2D | null;
};
