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
  mqttClientIdPrefix: readStringEnv("GAZECORE_MQTT_CLIENT_ID_PREFIX", "gazecore-backend"),
  gyroYawMultiplier: readNumberEnv("GAZECORE_GYRO_YAW_MULTIPLIER", 0.55),
  gyroPitchMultiplier: readNumberEnv("GAZECORE_GYRO_PITCH_MULTIPLIER", 0.55),
  gyroRollMultiplier: readNumberEnv("GAZECORE_GYRO_ROLL_MULTIPLIER", 0.08),
  websocketPath: "/api/gaze/screen/ws",
} as const

export function buildGyroTopic(uuid: string) {
  const normalizedUuid = uuid.trim()
  if (!normalizedUuid) {
    throw new Error("UUID is required to build the gyro topic.")
  }

  return `${gazeConfig.mqttTopicPrefix}/${normalizedUuid}/${gazeConfig.mqttGyroSuffix}`
}

export function buildWebSocketUrlFromRequest(request: Request) {
  const url = new URL(request.url)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = gazeConfig.websocketPath
  url.search = ""
  url.hash = ""
  return url.toString()
}
