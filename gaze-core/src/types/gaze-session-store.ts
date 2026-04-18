import type {
  CalibrationPayload,
  GazeAccessTokenClaims,
  GazeVectorPayload,
  GyroReading,
  SolvedGazePoint,
} from "@/lib/gaze-types";

export type IssuedTokenState = {
  claims: GazeAccessTokenClaims;
  gyroZeroSnapshot: GyroReading | null;
};

export type LivePreviewSessionState = {
  socketId: string;
  uuid: string;
  tokenId: string;
  calibration: CalibrationPayload | null;
  gyroZeroSnapshot: GyroReading | null;
  latestGaze: GazeVectorPayload | null;
  lastPoint: SolvedGazePoint | null;
  releaseGyroSubscription: (() => void) | null;
};
