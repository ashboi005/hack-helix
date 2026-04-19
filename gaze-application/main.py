from __future__ import annotations

import argparse
import os
import sys
import time

import cv2

from auth_dialog import collect_auth_session
from face_tracker import FaceTracker
from mqtt_publisher import MqttPublisher, MqttPublisherConfig

BACKEND_URL = "http://localhost:3000"
MQTT_BROKER_URL = "mqtt://broker.hivemq.com:1883"
MQTT_TOPIC_PREFIX = "eyetracker"
MQTT_TOPIC_SUFFIX = "gyro"

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


def main() -> int:
    args = parse_args()
    if sys.prefix == sys.base_prefix:
        print("Tip: activate your virtual environment before running this app.")

    print("Opening sign-in dialog...")
    session = collect_auth_session(BACKEND_URL, default_email=os.getenv("FOCUSLAYER_EMAIL"))
    if session is None:
        print("Authentication cancelled.")
        return 1

    topic = build_topic(MQTT_TOPIC_PREFIX, session.user_id, MQTT_TOPIC_SUFFIX)

    print(f"Signed in as {session.email} ({session.user_id})")
    print(f"Publishing MediaPipe face pose to MQTT topic: {topic}")
    print("Preview window: press q or Esc to quit.")

    tracker = FaceTracker(camera_index=args.camera_index)
    publisher = MqttPublisher(
        MqttPublisherConfig(
            broker_url=MQTT_BROKER_URL,
            topic=topic,
            client_id=args.client_id,
            username=args.mqtt_username,
            password=args.mqtt_password,
            qos=args.qos,
        )
    )

    publish_interval = 1.0 / max(args.publish_rate, 1.0)
    last_publish_at = 0.0
    last_log_at = 0.0

    try:
        publisher.connect()

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
            if pose is None:
                continue

            now = time.monotonic()
            if now - last_publish_at < publish_interval:
                continue

            payload = pose.as_mqtt_payload()
            payload["userId"] = session.user_id
            publisher.publish(payload)
            last_publish_at = now

            if now - last_log_at >= 1.0:
                print(
                    "pose",
                    f"x={pose.x:.2f}",
                    f"y={pose.y:.2f}",
                    f"z={pose.z:.2f}",
                    f"yaw={pose.yaw:.2f}",
                    f"pitch={pose.pitch:.2f}",
                    f"roll={pose.roll:.2f}",
                )
                last_log_at = now
    except KeyboardInterrupt:
        print("\nStopping face vector publisher...")
    finally:
        cv2.destroyAllWindows()
        tracker.close()
        publisher.disconnect()

    return 0


if __name__ == "__main__":
    sys.exit(main())
