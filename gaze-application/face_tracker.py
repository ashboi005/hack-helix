from __future__ import annotations

import math
import time
from dataclasses import dataclass

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


# ---------------------------------------------------------------------------
# Landmark indices — mirrors HeadTracker/MonitorTracking.py
# ---------------------------------------------------------------------------
# Five landmarks define the head coordinate frame:
#   left   (234) — left cheek
#   right  (454) — right cheek
#   top    ( 10) — forehead centre
#   bottom (152) — chin
#   nose   (  1) — nose tip  (forward-ray origin / position anchor)
#
# The forward vector is derived as:
#   right_axis = normalize(right − left)
#   up_axis    = normalize(top   − bottom)
#   forward    = −cross(right_axis, up_axis)   # negated → points OUT of face
#
# Angle sign convention (matches gaze-fusion consumer):
#   yaw   > 0  → face turns RIGHT   (forward_axis[0] increases in image space)
#   pitch > 0  → chin drops DOWN    (forward_axis[1] increases; image Y is down)
#   roll  > 0  → clockwise roll     (up_axis[0]      increases)
# ---------------------------------------------------------------------------
_LM_LEFT   = 234
_LM_RIGHT  = 454
_LM_TOP    = 10
_LM_BOTTOM = 152
_LM_NOSE   = 1

_PREVIEW_INDICES = [_LM_LEFT, _LM_RIGHT, _LM_TOP, _LM_BOTTOM, _LM_NOSE]


class FaceTracker:

    def __init__(
        self,
        camera_index: int = 0,
        min_detection_confidence: float = 0.6,
        min_tracking_confidence: float = 0.6,
        smoothing: float = 0.5,
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

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _lm_vec(landmark, w: int, h: int) -> np.ndarray:
        """Convert a normalised MediaPipe landmark to a pixel-space 3-D vector.

        MediaPipe encodes depth (z) in the same normalised units as x, so
        multiplying by frame width keeps all three axes consistently scaled.
        """
        return np.array([landmark.x * w, landmark.y * h, landmark.z * w], dtype=np.float64)

    def _compute_pose(
        self,
        landmarks,
        frame_width: int,
        frame_height: int,
    ) -> FacePose | None:
        """Derive yaw/pitch/roll from five facial landmarks (no solvePnP).

        Algorithm (projection-based, mirrors HeadTracker/MonitorTracking.py):
          1. right_axis = normalize(right_cheek − left_cheek).
          2. up_axis    = normalize(forehead   − chin).
          3. forward    = −cross(right_axis, up_axis)   # points OUT of face
             (at rest this equals [0, 0, −1] in MediaPipe's +Z-away frame.)
          4. Yaw   = angle of forward projected onto XZ-plane vs [0,0,−1].
             Pitch = angle of forward projected onto YZ-plane vs [0,0,−1].
             Roll  = angle of up_axis in the XY-plane vs [0,−1,0].

        WHY NOT arctan2(forward[0], forward[2])?  Because forward[2] ≈ −1 at
        rest, so arctan2 sits on the ±π discontinuity — a tiny head motion
        makes the output wrap from +180° to −180°, which the temporal
        smoother then averages to garbage.  The projection-based method
        stays well-behaved across the whole operating range.

        Sign convention (CONSUMER EXPECTS):
          yaw   > 0  → face physically turned RIGHT   (user's right)
          pitch > 0  → chin DROPS (user looks DOWN)
          roll  > 0  → user's RIGHT ear drops (CW tilt from user's POV)
        """
        w, h = frame_width, frame_height

        left   = self._lm_vec(landmarks[_LM_LEFT],   w, h)
        right  = self._lm_vec(landmarks[_LM_RIGHT],  w, h)
        top    = self._lm_vec(landmarks[_LM_TOP],    w, h)
        bottom = self._lm_vec(landmarks[_LM_BOTTOM], w, h)
        nose   = self._lm_vec(landmarks[_LM_NOSE],   w, h)

        right_vec = right - left
        r_norm = float(np.linalg.norm(right_vec))
        if r_norm < 1e-6:
            return None
        right_axis = right_vec / r_norm

        up_vec = top - bottom
        u_norm = float(np.linalg.norm(up_vec))
        if u_norm < 1e-6:
            return None
        up_axis = up_vec / u_norm

        forward_raw = np.cross(right_axis, up_axis)
        f_norm = float(np.linalg.norm(forward_raw))
        if f_norm < 1e-6:
            return None
        # Negate so forward points OUT of the face toward the camera (−Z in MP).
        forward_axis = -(forward_raw / f_norm)

        fx, fy, fz = float(forward_axis[0]), float(forward_axis[1]), float(forward_axis[2])
        ux, uy = float(up_axis[0]), float(up_axis[1])

        # --- YAW: projection onto XZ plane, angle from [0, 0, −1] -----------
        xz_len = math.hypot(fx, fz)
        if xz_len < 1e-8:
            yaw = 0.0
        else:
            cos_yaw = max(-1.0, min(1.0, -fz / xz_len))
            yaw_mag = math.degrees(math.acos(cos_yaw))
            # User yaws physically RIGHT  →  forward_axis[0] < 0 (derivation
            # in fix notes); we want POSITIVE yaw for that case.
            yaw = math.copysign(yaw_mag, -fx)

        # --- PITCH: projection onto YZ plane, angle from [0, 0, −1] ---------
        yz_len = math.hypot(fy, fz)
        if yz_len < 1e-8:
            pitch = 0.0
        else:
            cos_pitch = max(-1.0, min(1.0, -fz / yz_len))
            pitch_mag = math.degrees(math.acos(cos_pitch))
            # Chin DROPS  →  forward_axis[1] > 0 (image-Y is downward);
            # we want POSITIVE pitch for that case.
            pitch = math.copysign(pitch_mag, fy)

        # --- ROLL: angle of up_axis in XY plane vs [0, −1, 0] ---------------
        xy_len = math.hypot(ux, uy)
        if xy_len < 1e-8:
            roll = 0.0
        else:
            cos_roll = max(-1.0, min(1.0, -uy / xy_len))
            roll_mag = math.degrees(math.acos(cos_roll))
            # User's RIGHT ear drops  →  up_axis[0] < 0 (top of head rotates
            # toward image-left); we want POSITIVE roll for that case.
            roll = math.copysign(roll_mag, -ux)

        return FacePose(
            x=float(nose[0]),
            y=float(nose[1]),
            z=float(nose[2]),
            yaw=float(yaw),
            pitch=float(pitch),
            roll=float(roll),
            timestamp=int(time.time() * 1000),
            confidence=1.0,
            frame_width=frame_width,
            frame_height=frame_height,
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

    def _landmark_points(
        self, landmarks, frame_width: int, frame_height: int
    ) -> list[tuple[int, int]]:
        return [
            (int(landmarks[i].x * frame_width), int(landmarks[i].y * frame_height))
            for i in _PREVIEW_INDICES
        ]

    # ------------------------------------------------------------------
    # Public API (unchanged interface)
    # ------------------------------------------------------------------

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
        pose = self._compute_pose(landmarks, frame_width, frame_height)
        if pose is None:
            return FaceFrame(pose=None, frame=frame, landmarks=None)

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

        # Draw the five key landmarks
        for point in frame_data.landmarks or []:
            cv2.circle(overlay, point, 4, (0, 220, 255), -1)

        # Draw the forward-direction arrow projected from the nose tip
        nose_2d = (int(pose.x), int(pose.y))
        ray_len = 80
        ray_end = (
            int(pose.x + ray_len * np.sin(np.radians(pose.yaw))),
            int(pose.y + ray_len * np.sin(np.radians(pose.pitch))),
        )
        cv2.arrowedLine(overlay, nose_2d, ray_end, (0, 255, 0), 2, tipLength=0.3)

        # Info panel
        cv2.rectangle(overlay, (12, 12), (420, 170), (15, 15, 15), -1)
        cv2.rectangle(overlay, (12, 12), (420, 170), (255, 255, 255), 1)
        lines = [
            "Face Vector Preview  (nose-based)",
            f"Nose px: ({pose.x:.0f}, {pose.y:.0f})  depth: {pose.z:.0f}",
            f"Yaw:   {pose.yaw:+.2f} deg   (+ = right)",
            f"Pitch: {pose.pitch:+.2f} deg   (+ = chin down)",
            f"Roll:  {pose.roll:+.2f} deg   (+ = CW)",
        ]
        for index, line in enumerate(lines):
            cv2.putText(
                overlay,
                line,
                (24, 36 + index * 26),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )

        return output

    def close(self) -> None:
        self.face_mesh.close()
        self.capture.release()
