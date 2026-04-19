from __future__ import annotations

import argparse
import os
import sys
import time
from collections import deque
from dataclasses import dataclass, field

import cv2

from auth_dialog import collect_auth_session
from face_tracker import FacePose, FaceTracker
from mqtt_publisher import MqttPublisher, MqttPublisherConfig

BACKEND_URL = "http://localhost:3000"
MQTT_BROKER_URL = "mqtt://broker.hivemq.com:1883"
MQTT_TOPIC_PREFIX = "eyetracker"
MQTT_TOPIC_SUFFIX = "gyro"
MQTT_CALIBRATION_CONTROL_SUFFIX = "calibration/control"
MQTT_CALIBRATION_RESULT_SUFFIX = "calibration/result"


@dataclass(slots=True)
class CaptureRequest:
    uuid: str
    capture_id: str
    point_index: int
    duration_ms: int
    started_at: int
    accepted_at: int
    result_topic: str


@dataclass(slots=True)
class ActiveCapture:
    request: CaptureRequest
    samples: list[FacePose] = field(default_factory=list)
    published: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Track face pose with MediaPipe and publish it to the Gaze Core MQTT topic."
    )
    parser.add_argument("--mqtt-username", default=os.getenv("MQTT_USERNAME"))
    parser.add_argument("--mqtt-password", default=os.getenv("MQTT_PASSWORD"))
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--publish-rate", type=float, default=12.0, help="MQTT publish rate in Hz.")
    parser.add_argument("--qos", type=int, choices=(0, 1, 2), default=0)
    parser.add_argument(
        "--client-id",
        default=f"mediapipe-face-publisher-{int(time.time())}",
        help="MQTT client id. Default: %(default)s",
    )
    return parser.parse_args()


def build_topic(topic_prefix: str, user_id: str, topic_suffix: str) -> str:
    normalized_user_id = user_id.strip()
    if not normalized_user_id:
        raise ValueError("The authenticated backend response did not include a valid user ID.")
    return f"{topic_prefix.strip().strip('/')}/{normalized_user_id}/{topic_suffix.strip().strip('/')}"


def summarize_capture(samples: list[FacePose]) -> dict | None:
    if not samples:
        return None

    count = len(samples)
    avg = lambda values: sum(values) / count
    started_at = min(sample.timestamp for sample in samples)
    ended_at = max(sample.timestamp for sample in samples)
    confidence = avg([sample.confidence for sample in samples])
    first = samples[-1]

    return {
        "x": avg([sample.x for sample in samples]),
        "y": avg([sample.y for sample in samples]),
        "z": avg([sample.z for sample in samples]),
        "yaw": avg([sample.yaw for sample in samples]),
        "pitch": avg([sample.pitch for sample in samples]),
        "roll": avg([sample.roll for sample in samples]),
        "timestamp": ended_at,
        "startedAt": started_at,
        "endedAt": ended_at,
        "sampleCount": count,
        "confidence": confidence,
        "quality": confidence,
        "source": "mediapipe-face-vector",
        "kind": "face-pose",
        "frame": {
            "width": first.frame_width,
            "height": first.frame_height,
        },
    }


def main() -> int:
    args = parse_args()
    if sys.prefix == sys.base_prefix:
        print("Tip: activate your virtual environment before running this app.")

    print("Opening sign-in dialog...")
    session = collect_auth_session(BACKEND_URL, default_email=os.getenv("FOCUSLAYER_EMAIL"))
    if session is None:
        print("Authentication cancelled.")
        return 1

    live_topic = build_topic(MQTT_TOPIC_PREFIX, session.user_id, MQTT_TOPIC_SUFFIX)
    control_topic = build_topic(MQTT_TOPIC_PREFIX, session.user_id, MQTT_CALIBRATION_CONTROL_SUFFIX)
    result_topic = build_topic(MQTT_TOPIC_PREFIX, session.user_id, MQTT_CALIBRATION_RESULT_SUFFIX)

    print(f"Signed in as {session.email} ({session.user_id})")
    print(f"Publishing MediaPipe face pose to MQTT topic: {live_topic}")
    print(f"Listening for calibration control on: {control_topic}")
    print(f"Publishing calibration summaries to: {result_topic}")
    print("Preview window: press q or Esc to quit.")

    tracker = FaceTracker(camera_index=args.camera_index)
    publisher = MqttPublisher(
        MqttPublisherConfig(
            broker_url=MQTT_BROKER_URL,
            topic=live_topic,
            client_id=args.client_id,
            username=args.mqtt_username,
            password=args.mqtt_password,
            qos=args.qos,
        )
    )

    pending_requests: deque[CaptureRequest] = deque()
    active_capture: ActiveCapture | None = None
    publish_interval = 1.0 / max(args.publish_rate, 1.0)
    last_publish_at = 0.0
    last_log_at = 0.0

    def handle_control_message(topic: str, payload: dict) -> None:
        if payload.get("kind") != "calibration-record-start":
            return

        capture_id = str(payload.get("captureId", "")).strip()
        if not capture_id:
            return

        request = CaptureRequest(
            uuid=str(payload.get("uuid", session.user_id)).strip() or session.user_id,
            capture_id=capture_id,
            point_index=int(payload.get("pointIndex", 0)),
            duration_ms=max(int(payload.get("durationMs", 3000)), 250),
            started_at=int(payload.get("startedAt", time.time() * 1000)),
            accepted_at=int(payload.get("acceptedAt", time.time() * 1000)),
            result_topic=str(payload.get("resultTopic", result_topic)).strip() or result_topic,
        )
        pending_requests.append(request)

    try:
        publisher.connect()
        publisher.subscribe(control_topic, handle_control_message)

        while True:
            frame_data = tracker.read_frame()
            if frame_data is None:
                time.sleep(0.02)
                continue

            preview_frame = tracker.draw_preview(frame_data.frame, frame_data)
            cv2.imshow("Face Vector Preview", preview_frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break

            pose = frame_data.pose
            if pending_requests and active_capture is None:
                active_capture = ActiveCapture(request=pending_requests.popleft())

            now_monotonic = time.monotonic()
            now_ms = int(time.time() * 1000)

            if pose is not None and now_monotonic - last_publish_at >= publish_interval:
                payload = pose.as_mqtt_payload()
                payload["userId"] = session.user_id
                publisher.publish(payload)
                last_publish_at = now_monotonic

            if pose is not None and now_monotonic - last_log_at >= 1.0:
                print(
                    "pose",
                    f"x={pose.x:.2f}",
                    f"y={pose.y:.2f}",
                    f"z={pose.z:.2f}",
                    f"yaw={pose.yaw:.2f}",
                    f"pitch={pose.pitch:.2f}",
                    f"roll={pose.roll:.2f}",
                )
                last_log_at = now_monotonic

            if active_capture is None:
                continue

            capture_end = active_capture.request.started_at + active_capture.request.duration_ms
            if pose is not None and active_capture.request.started_at <= pose.timestamp <= capture_end:
                active_capture.samples.append(pose)

            if now_ms < capture_end:
                continue

            if not active_capture.published:
                summary = summarize_capture(active_capture.samples)
                if summary is not None:
                    publisher.publish(
                        {
                            "kind": "calibration-result",
                            "uuid": active_capture.request.uuid,
                            "captureId": active_capture.request.capture_id,
                            "pointIndex": active_capture.request.point_index,
                            "summary": summary,
                        },
                        topic=active_capture.request.result_topic,
                    )
                active_capture.published = True

            active_capture = None
    except KeyboardInterrupt:
        print("\nStopping face vector publisher...")
    finally:
        cv2.destroyAllWindows()
        tracker.close()
        publisher.disconnect()

    return 0


if __name__ == "__main__":
    sys.exit(main())
