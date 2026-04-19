from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse

try:
    import paho.mqtt.client as mqtt
except ImportError as exc:  # pragma: no cover - import guard for runtime setup
    raise RuntimeError(
        "Missing dependency 'paho-mqtt'. Install it with: pip install paho-mqtt"
    ) from exc


MessageHandler = Callable[[str, dict], None]


@dataclass(slots=True)
class MqttPublisherConfig:
    broker_url: str
    topic: str
    client_id: str
    username: str | None = None
    password: str | None = None
    qos: int = 0
    keepalive: int = 60
    retain: bool = False


class MqttPublisher:
    def __init__(self, config: MqttPublisherConfig) -> None:
        self.config = config
        callback_api = getattr(mqtt, "CallbackAPIVersion", None)
        try:
            if callback_api is None:
                raise AttributeError
            self.client = mqtt.Client(
                callback_api_version=callback_api.VERSION2,
                client_id=config.client_id,
                clean_session=True,
                protocol=mqtt.MQTTv311,
            )
        except (AttributeError, TypeError):
            self.client = mqtt.Client(
                client_id=config.client_id,
                clean_session=True,
                protocol=mqtt.MQTTv311,
            )
        if config.username:
            self.client.username_pw_set(config.username, config.password)

        self._connected = False
        self._subscriptions: dict[str, MessageHandler] = {}
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties=None) -> None:
        self._connected = reason_code == 0
        if reason_code != 0:
            raise RuntimeError(f"MQTT connection failed with code {reason_code}")

        for topic in self._subscriptions:
            client.subscribe(topic, qos=self.config.qos)

    def _on_disconnect(self, client, userdata, *args) -> None:
        self._connected = False

    def _on_message(self, client, userdata, message) -> None:
        handler = self._subscriptions.get(message.topic)
        if handler is None:
            return

        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except json.JSONDecodeError:
            return

        if isinstance(payload, dict):
            handler(message.topic, payload)

    def connect(self) -> None:
        parsed = urlparse(self.config.broker_url)
        scheme = (parsed.scheme or "mqtt").lower()
        host = parsed.hostname
        if not host:
            raise ValueError(f"Invalid MQTT broker URL: {self.config.broker_url}")

        use_tls = scheme in {"mqtts", "ssl", "tls"}
        port = parsed.port or (8883 if use_tls else 1883)

        if use_tls:
            self.client.tls_set()

        self.client.connect(host, port, keepalive=self.config.keepalive)
        self.client.loop_start()

        deadline = time.monotonic() + 10.0
        while not self._connected and time.monotonic() < deadline:
            time.sleep(0.05)

        if not self._connected:
            raise RuntimeError(f"Timed out while connecting to MQTT broker {self.config.broker_url}")

    def publish(self, payload: dict, *, topic: str | None = None) -> None:
        message = json.dumps(payload, separators=(",", ":"))
        result = self.client.publish(
            topic or self.config.topic,
            payload=message,
            qos=self.config.qos,
            retain=self.config.retain,
        )
        result.wait_for_publish()
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"Failed to publish MQTT message: rc={result.rc}")

    def subscribe(self, topic: str, handler: MessageHandler) -> None:
        self._subscriptions[topic] = handler
        if self._connected:
            self.client.subscribe(topic, qos=self.config.qos)

    def disconnect(self) -> None:
        try:
            if self._connected:
                self.client.disconnect()
        finally:
            self.client.loop_stop()
