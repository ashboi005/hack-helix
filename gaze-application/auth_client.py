from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


@dataclass(slots=True)
class AuthSession:
    token: str
    user_id: str
    email: str
    name: str


def _request_auth(backend_url: str, path: str, body: dict[str, str], timeout_seconds: float = 10.0) -> dict:
    endpoint_url = urljoin(backend_url.rstrip("/") + "/", path.lstrip("/"))
    payload = json.dumps(body).encode("utf-8")
    request = Request(
        endpoint_url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw_body = response.read().decode("utf-8")
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Auth request failed with HTTP {exc.code}: {details}") from exc
    except URLError as exc:
        raise RuntimeError(f"Unable to reach backend at {endpoint_url}: {exc.reason}") from exc

    decoded = json.loads(raw_body)
    if not isinstance(decoded, dict):
        raise RuntimeError("Auth response must be a JSON object.")

    return decoded


def _build_session(decoded: dict, fallback_email: str) -> AuthSession:
    user = decoded.get("user") or {}
    token = decoded.get("token")
    user_id = user.get("id")

    if not token or not user_id:
        raise RuntimeError("Auth response did not contain both token and user.id.")

    return AuthSession(
        token=str(token),
        user_id=str(user_id),
        email=str(user.get("email") or fallback_email),
        name=str(user.get("name") or ""),
    )


def sign_in(backend_url: str, email: str, password: str, timeout_seconds: float = 10.0) -> AuthSession:
    decoded = _request_auth(
        backend_url,
        "/auth/login",
        {"email": email, "password": password},
        timeout_seconds=timeout_seconds,
    )
    return _build_session(decoded, email)


def sign_up(
    backend_url: str,
    name: str,
    email: str,
    password: str,
    timeout_seconds: float = 10.0,
) -> AuthSession:
    decoded = _request_auth(
        backend_url,
        "/auth/signup",
        {"name": name, "email": email, "password": password},
        timeout_seconds=timeout_seconds,
    )
    return _build_session(decoded, email)
