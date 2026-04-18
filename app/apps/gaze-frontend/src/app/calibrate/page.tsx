"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { GazeCoreWidget } from "@/components/gaze-core-widget"
import { getGazeCoreDemoConfig } from "@/lib/gaze/gaze-core-demo-config"
import { useSession, signOut } from "@/lib/auth-client"

type EyeTokenPayload = {
  token: string
  uuid: string
  expiresAt: string
  expiresInSeconds: number
  websocketUrl?: string
}

type SetupSession = {
  userId: string
  userName: string
  email: string
  uuid: string
  token: string
  websocketUrl?: string
}

type ErrorPayload = {
  error?: string
  message?: string
  code?: string
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/g, "")
}

function extractErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") return fallbackMessage
  const record = payload as Record<string, unknown>

  if (typeof record.error === "string" && record.error.trim()) return record.error
  if (typeof record.message === "string" && record.message.trim()) return record.message
  if (typeof record.code === "string" && record.code.trim()) return record.code
  return fallbackMessage
}

export default function CalibratePage() {
  const router = useRouter()
  const initialConfig = getGazeCoreDemoConfig()
  const backendBaseUrl = normalizeBaseUrl(initialConfig.appBackendBaseUrl)

  const { data: authSession, isPending: authPending } = useSession()

  const [session, setSession] = useState<SetupSession | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [error, setError] = useState("")

  const fetchEyeToken = useCallback(async (): Promise<EyeTokenPayload> => {
    // Use cookie-based auth (credentials: include) instead of Bearer token
    const eyeTokenResponse = await fetch(new URL("/eye/token", `${backendBaseUrl}/`), {
      method: "POST",
      credentials: "include",
    })

    const eyeTokenPayload = await eyeTokenResponse.json().catch(() => null) as EyeTokenPayload | ErrorPayload | null
    if (!eyeTokenResponse.ok || !eyeTokenPayload || typeof eyeTokenPayload !== "object" || typeof (eyeTokenPayload as EyeTokenPayload).token !== "string") {
      throw new Error(extractErrorMessage(eyeTokenPayload, "Unable to initialize gaze access token."))
    }

    return eyeTokenPayload as EyeTokenPayload
  }, [backendBaseUrl])

  // Wait for Better Auth session, then fetch eye token
  useEffect(() => {
    if (authPending) return

    if (!authSession?.user?.id) {
      router.replace("/login?next=/calibrate")
      return
    }

    let cancelled = false

    async function init() {
      setError("")
      try {
        const eyeToken = await fetchEyeToken()
        if (cancelled) return

        setSession({
          userId: authSession!.user.id,
          userName: authSession!.user.name,
          email: authSession!.user.email,
          uuid: eyeToken.uuid,
          token: eyeToken.token,
          websocketUrl: eyeToken.websocketUrl,
        })
      } catch (caughtError) {
        if (cancelled) return
        setError(caughtError instanceof Error ? caughtError.message : "Failed to initialize gaze session.")
      } finally {
        if (!cancelled) {
          setAuthChecked(true)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [authSession, authPending, fetchEyeToken, router])

  async function reissueEyeToken() {
    if (!authSession?.user?.id) return

    setRefreshBusy(true)
    setError("")
    try {
      const eyeToken = await fetchEyeToken()
      setSession({
        userId: authSession.user.id,
        userName: authSession.user.name,
        email: authSession.user.email,
        uuid: eyeToken.uuid,
        token: eyeToken.token,
        websocketUrl: eyeToken.websocketUrl,
      })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to refresh gaze token.")
    } finally {
      setRefreshBusy(false)
    }
  }

  async function handleLogout() {
    await signOut()
    router.push("/login")
  }

  if (authPending || !authChecked) {
    return (
      <main className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto max-w-4xl rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          Checking authentication and preparing setup...
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto max-w-4xl rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {error ? (
            <p className="text-red-500">{error}</p>
          ) : (
            "Redirecting to login..."
          )}
        </div>
      </main>
    )
  }

  const widgetConfig = {
    backendBaseUrl,
    authToken: session.token, // pass gaze token for the widget
    deviceUuid: session.uuid,
    livePreviewSocketUrl: session.websocketUrl,
    livePreviewToken: session.token,
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b bg-card/70 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Eye Tracker Setup</h1>
            <p className="text-sm text-muted-foreground">
              Complete the guided 5-step setup to calibrate and enable eye tracking.
            </p>
          </div>

          {error && (
            <p className="rounded-md border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-4 text-sm text-muted-foreground">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-foreground/70">Signed In</p>
              <p className="font-medium text-foreground">{session.userName}</p>
              <p className="text-xs text-muted-foreground break-all">{session.email}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void reissueEyeToken()}
                disabled={refreshBusy}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold uppercase tracking-[0.08em] text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {refreshBusy ? "Refreshing..." : "Refresh Session"}
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-xs font-semibold uppercase tracking-[0.08em] text-foreground hover:bg-muted"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      </section>

      <GazeCoreWidget {...widgetConfig} />

      {session && (
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
          >
            Calibration Done →
          </button>
        </div>
      )}
    </main>
  )
}
