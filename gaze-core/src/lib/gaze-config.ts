function readNumberEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readStringEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim()
  return value ? value : fallback
}

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  return fallback
}

const mqttHost = readStringEnv("GAZECORE_MQTT_BROKER_HOST", "broker.hivemq.com")
const mqttPort = readNumberEnv("GAZECORE_MQTT_BROKER_PORT", 1883)

export const gazeConfig = {
  tokenSecret: readStringEnv("GAZECORE_TOKEN_SECRET", process.env.BETTER_AUTH_SECRET || "gazecore-dev-secret"),
  emailUuidSecret: readStringEnv(
    "GAZECORE_EMAIL_UUID_SECRET",
    readStringEnv("GAZECORE_TOKEN_SECRET", process.env.BETTER_AUTH_SECRET || "gazecore-dev-secret"),
  ),
  tokenIssuer: readStringEnv("GAZECORE_TOKEN_ISSUER", "gazecore-backend"),
  tokenAudience: readStringEnv("GAZECORE_TOKEN_AUDIENCE", "gazecore-widget"),
  tokenTtlSeconds: readNumberEnv("GAZECORE_TOKEN_TTL_SECONDS", 60 * 60),
  gyroSnapshotTimeoutMs: readNumberEnv("GAZECORE_GYRO_SNAPSHOT_TIMEOUT_MS", 5000),
  mqttBrokerUrl: readStringEnv("GAZECORE_MQTT_BROKER_URL", `mqtt://${mqttHost}:${mqttPort}`),
  mqttTopicPrefix: readStringEnv("GAZECORE_MQTT_TOPIC_PREFIX", "eyetracker"),
  mqttGyroSuffix: readStringEnv("GAZECORE_MQTT_GYRO_SUFFIX", "gyro"),
  mqttCalibrationControlSuffix: readStringEnv("GAZECORE_MQTT_CALIBRATION_CONTROL_SUFFIX", "calibration/control"),
  mqttCalibrationResultSuffix: readStringEnv("GAZECORE_MQTT_CALIBRATION_RESULT_SUFFIX", "calibration/result"),
  mqttClientIdPrefix: readStringEnv("GAZECORE_MQTT_CLIENT_ID_PREFIX", "gazecore-backend"),
  gyroYawMultiplier: readNumberEnv("GAZECORE_GYRO_YAW_MULTIPLIER", 0.55),
  gyroPitchMultiplier: readNumberEnv("GAZECORE_GYRO_PITCH_MULTIPLIER", 0.55),
  gyroRollMultiplier: readNumberEnv("GAZECORE_GYRO_ROLL_MULTIPLIER", 0.08),
  headPoseYawCompensation: readNumberEnv("GAZECORE_HEAD_POSE_YAW_COMPENSATION", 0.2),
  headPosePitchCompensation: readNumberEnv("GAZECORE_HEAD_POSE_PITCH_COMPENSATION", 0.2),
  headPoseRollCompensation: readNumberEnv("GAZECORE_HEAD_POSE_ROLL_COMPENSATION", 0.1),
  headPoseAutoMirrorHorizontal: readBooleanEnv("GAZECORE_HEAD_POSE_AUTO_MIRROR_HORIZONTAL", true),
  headPoseHorizontalSign: readNumberEnv("GAZECORE_HEAD_POSE_HORIZONTAL_SIGN", -1),
  headPoseYawDeadzoneDeg: readNumberEnv("GAZECORE_HEAD_POSE_YAW_DEADZONE_DEG", 0.75),
  headPosePitchDeadzoneDeg: readNumberEnv("GAZECORE_HEAD_POSE_PITCH_DEADZONE_DEG", 0.75),
  headPoseRollDeadzoneDeg: readNumberEnv("GAZECORE_HEAD_POSE_ROLL_DEADZONE_DEG", 1.0),
  headPoseTranslationDeadzone: readNumberEnv("GAZECORE_HEAD_POSE_TRANSLATION_DEADZONE", 1.5),
  headTranslationXMultiplier: readNumberEnv("GAZECORE_HEAD_TRANSLATION_X_MULTIPLIER", 0),
  headTranslationYMultiplier: readNumberEnv("GAZECORE_HEAD_TRANSLATION_Y_MULTIPLIER", 0),
  headTranslationZMultiplier: readNumberEnv("GAZECORE_HEAD_TRANSLATION_Z_MULTIPLIER", 0),
  calibrationCaptureResultTimeoutMs: readNumberEnv("GAZECORE_CAPTURE_RESULT_TIMEOUT_MS", 6000),
  calibrationFaceConfidenceThreshold: readNumberEnv("GAZECORE_FACE_CONFIDENCE_THRESHOLD", 0.45),
  calibrationCaptureSkewToleranceMs: readNumberEnv("GAZECORE_CAPTURE_SKEW_TOLERANCE_MS", 1500),
  websocketPath: "/api/gaze/screen/ws",
} as const

export function buildGyroTopic(uuid: string) {
  return buildTopic(uuid, gazeConfig.mqttGyroSuffix)
}

export function buildCalibrationControlTopic(uuid: string) {
  return buildTopic(uuid, gazeConfig.mqttCalibrationControlSuffix)
}

export function buildCalibrationResultTopic(uuid: string) {
  return buildTopic(uuid, gazeConfig.mqttCalibrationResultSuffix)
}

function buildTopic(uuid: string, suffix: string) {
  const normalizedUuid = uuid.trim()
  if (!normalizedUuid) {
    throw new Error("UUID is required to build the MQTT topic.")
  }

  return `${gazeConfig.mqttTopicPrefix}/${normalizedUuid}/${suffix}`
}

export function buildWebSocketUrlFromRequest(request: Request) {
  const url = new URL(request.url)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = gazeConfig.websocketPath
  url.search = ""
  url.hash = ""
  return url.toString()
}
