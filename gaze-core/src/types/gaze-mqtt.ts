import type { GyroReading } from "@/lib/gaze-types";

export type GyroWaiter = {
  minTimestamp: number;
  resolve: (reading: GyroReading) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type TopicSubscription = {
  uuid: string;
  topic: string;
  refCount: number;
};

export type GyroPayloadRecord = Record<string, unknown>;
