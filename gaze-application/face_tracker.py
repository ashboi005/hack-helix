from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Iterable

try:
    import cv2
    import mediapipe as mp
    import numpy as np
except ImportError as exc:  # pragma: no cover - import guard for runtime setup
    raise RuntimeError(
        "Missing dependencies. Install them with: pip install mediapipe opencv-python numpy"
    ) from exc


@dataclass(slots=True)
class FacePose:
    x: float
    y: float
    z: float
    yaw: float
    pitch: float
    roll: float
    timestamp: int
    confidence: float
    frame_width: int
    frame_height: int

    def as_mqtt_payload(self) -> dict:
        return {
            "kind": "face-pose",
            "source": "mediapipe-face-vector",
            "position": {
                "x": self.x,
                "y": self.y,
                "z": self.z,
            },
            "rotation": {
                "yaw": self.yaw,
                "pitch": self.pitch,
                "roll": self.roll,
            },
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "yaw": self.yaw,
            "pitch": self.pitch,
            "roll": self.roll,
            "confidence": self.confidence,
            "timestamp": self.timestamp,
            "frame": {
                "width": self.frame_width,
                "height": self.frame_height,
            },
        }


@dataclass(slots=True)
class FaceFrame:
    pose: FacePose | None
    frame: "np.ndarray"
    landmarks: list[tuple[int, int]] | None


class FaceTracker:
    _FACE_MODEL_POINTS = np.array(
        [
            (0.0, 0.0, 0.0),
            (0.0, -63.6, -12.5),
            (-43.3, 32.7, -26.0),
            (43.3, 32.7, -26.0),
            (-28.9, -28.9, -24.1),
            (28.9, -28.9, -24.1),
        ],
        dtype=np.float64,
    )

    _LANDMARK_IDS = {
        "nose_tip": 1,
        "chin": 152,
        "left_eye_outer": 33,
        "right_eye_outer": 263,
        "left_mouth": 61,
        "right_mouth": 291,
    }

    def __init__(
        self,
        camera_index: int = 0,
        min_detection_confidence: float = 0.6,
        min_tracking_confidence: float = 0.6,
        smoothing: float = 0.35,
    ) -> None:
        self.capture = cv2.VideoCapture(camera_index)
        if not self.capture.isOpened():
            raise RuntimeError(f"Unable to open camera index {camera_index}")

        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=False,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self.smoothing = max(0.0, min(smoothing, 0.95))
        self._last_pose: FacePose | None = None

    def _landmark_points(self, landmarks, frame_width: int, frame_height: int) -> list[tuple[int, int]]:
        return [
            (
                int(landmarks[index].x * frame_width),
                int(landmarks[index].y * frame_height),
            )
            for index in self._LANDMARK_IDS.values()
        ]

    def _extract_image_points(self, landmarks, frame_width: int, frame_height: int) -> np.ndarray:
        return np.array(
            [
                (
                    landmarks[index].x * frame_width,
                    landmarks[index].y * frame_height,
                )
                for index in self._LANDMARK_IDS.values()
            ],
            dtype=np.float64,
        )

    def _smooth_pose(self, pose: FacePose) -> FacePose:
        if self._last_pose is None:
            self._last_pose = pose
            return pose

        alpha = self.smoothing
        smoothed = FacePose(
            x=self._last_pose.x + (pose.x - self._last_pose.x) * alpha,
            y=self._last_pose.y + (pose.y - self._last_pose.y) * alpha,
            z=self._last_pose.z + (pose.z - self._last_pose.z) * alpha,
            yaw=self._last_pose.yaw + (pose.yaw - self._last_pose.yaw) * alpha,
            pitch=self._last_pose.pitch + (pose.pitch - self._last_pose.pitch) * alpha,
            roll=self._last_pose.roll + (pose.roll - self._last_pose.roll) * alpha,
            timestamp=pose.timestamp,
            confidence=pose.confidence,
            frame_width=pose.frame_width,
            frame_height=pose.frame_height,
        )
        self._last_pose = smoothed
        return smoothed

    def read(self) -> FacePose | None:
        frame = self.read_frame()
        return frame.pose if frame else None

    def read_frame(self) -> FaceFrame | None:
        ok, frame = self.capture.read()
        if not ok:
            return None

        frame_height, frame_width = frame.shape[:2]
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self.face_mesh.process(rgb_frame)
        if not result.multi_face_landmarks:
            return FaceFrame(pose=None, frame=frame, landmarks=None)

        landmarks = result.multi_face_landmarks[0].landmark
        image_points = self._extract_image_points(landmarks, frame_width, frame_height)

        focal_length = frame_width
        center = (frame_width / 2, frame_height / 2)
        camera_matrix = np.array(
            [
                [focal_length, 0, center[0]],
                [0, focal_length, center[1]],
                [0, 0, 1],
            ],
            dtype=np.float64,
        )
        distortion = np.zeros((4, 1), dtype=np.float64)

        solved, rotation_vector, translation_vector = cv2.solvePnP(
            self._FACE_MODEL_POINTS,
            image_points,
            camera_matrix,
            distortion,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not solved:
            return None

        rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
        projection_matrix = np.hstack((rotation_matrix, translation_vector))
        _, _, _, _, _, _, euler_angles = cv2.decomposeProjectionMatrix(projection_matrix)

        pitch = float(euler_angles[0, 0])
        yaw = float(euler_angles[1, 0])
        roll = float(euler_angles[2, 0])
        x, y, z = (float(value) for value in translation_vector.reshape(3))

        pose = FacePose(
            x=x,
            y=y,
            z=z,
            yaw=yaw,
            pitch=pitch,
            roll=roll,
            timestamp=int(time.time() * 1000),
            confidence=1.0,
            frame_width=frame_width,
            frame_height=frame_height,
        )
        smoothed_pose = self._smooth_pose(pose)
        return FaceFrame(
            pose=smoothed_pose,
            frame=frame,
            landmarks=self._landmark_points(landmarks, frame_width, frame_height),
        )

    def draw_preview(self, frame: "np.ndarray", frame_data: FaceFrame | None) -> "np.ndarray":
        output = frame.copy()
        overlay = output

        if frame_data is None or frame_data.pose is None:
            cv2.putText(
                overlay,
                "No face detected",
                (18, 32),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (0, 0, 255),
                2,
                cv2.LINE_AA,
            )
            return output

        pose = frame_data.pose
        for point in frame_data.landmarks or []:
            cv2.circle(overlay, point, 3, (0, 220, 255), -1)

        cv2.rectangle(overlay, (12, 12), (410, 182), (15, 15, 15), -1)
        cv2.rectangle(overlay, (12, 12), (410, 182), (255, 255, 255), 1)

        lines = [
            "Face Vector Preview",
            f"X: {pose.x:.2f}",
            f"Y: {pose.y:.2f}",
            f"Z: {pose.z:.2f}",
            f"Yaw: {pose.yaw:.2f}",
            f"Pitch: {pose.pitch:.2f}",
            f"Roll: {pose.roll:.2f}",
            f"Confidence: {pose.confidence:.2f}",
        ]

        for index, line in enumerate(lines):
            y = 36 + index * 22
            cv2.putText(
                overlay,
                line,
                (24, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.62,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )

        return output

    def close(self) -> None:
        self.face_mesh.close()
        self.capture.release()
