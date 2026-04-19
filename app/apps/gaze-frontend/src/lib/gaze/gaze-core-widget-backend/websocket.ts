export class WebSocketAuthorizationError extends Error {
  constructor(message = "Unauthorized websocket connection.") {
    super(message)
    this.name = "WebSocketAuthorizationError"
  }
}

function parseMessagePayload(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function connectLivePreviewSocket(input: {
  socketUrl: string
  token: string
  timeoutMs?: number
}) {
  const url = new URL(input.socketUrl)
  url.searchParams.set("token", input.token)

  // Always use wss:// when the page is served over HTTPS. The server may be
  // behind a TLS-terminating proxy that returns ws:// URLs — upgrade them here.
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    url.protocol = "wss:"
  }

  return await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url.toString())
    const timeout = window.setTimeout(() => {
      cleanup()
      socket.close()
      reject(new Error("Timed out while connecting to the live preview websocket."))
    }, input.timeoutMs ?? 5000)

    function cleanup() {
      window.clearTimeout(timeout)
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
    }

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return

      const payload = parseMessagePayload(event.data)
      if (!payload) return

      if (payload.type === "connected") {
        cleanup()
        resolve(socket)
        return
      }

      if (payload.type === "error" && /token|unauthorized|expired/i.test(String(payload.detail ?? payload.message ?? ""))) {
        cleanup()
        socket.close()
        reject(new WebSocketAuthorizationError(String(payload.detail ?? payload.message ?? "Unauthorized websocket connection.")))
      }
    }

    socket.onerror = () => {
      // Wait for close/timeout so we can preserve websocket close codes where possible.
    }

    socket.onclose = (event) => {
      cleanup()
      if (event.code === 4401 || event.code === 4403) {
        reject(new WebSocketAuthorizationError(event.reason || "Unauthorized websocket connection."))
        return
      }

      reject(new Error(event.reason || `Live preview websocket closed before it connected (${event.code}).`))
    }
  })
}
