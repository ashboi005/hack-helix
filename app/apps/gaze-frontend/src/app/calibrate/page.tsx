
"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { GazeCoreWidget } from "@/components/gaze-core-widget"
import { getGazeCoreDemoConfig } from "@/lib/gaze/gaze-core-demo-config"
import { issueDemoGazeSession, type GazeCoreDemoSession } from "@/lib/gaze/gaze-core-demo-session"
import { useRouter } from "next/navigation"

export default function CalibratePage() {
  const router = useRouter()
  const initialConfig = getGazeCoreDemoConfig()

  const [backendBaseUrl, setBackendBaseUrl] = useState(initialConfig.backendBaseUrl)
  const [email, setEmail] = useState(initialConfig.email ?? "")
  const [apiKey, setApiKey] = useState(initialConfig.apiKey ?? "")
  const [session, setSession] = useState<GazeCoreDemoSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const didAutoIssueRef = useRef(false)

  // Auto-issue session if all env vars are pre-filled
  useEffect(() => {
    if (didAutoIssueRef.current) return
    if (!backendBaseUrl || !apiKey || !email) return
    didAutoIssueRef.current = true

    issueDemoGazeSession({ backendBaseUrl, apiKey, email })
      .then(setSession)
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to issue session."))
  }, [backendBaseUrl, apiKey, email])

  async function handleIssueSession(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    setBusy(true)
    setError("")
    try {
      const nextSession = await issueDemoGazeSession({ backendBaseUrl, apiKey, email })
      setSession(nextSession)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to issue session.")
    } finally {
      setBusy(false)
    }
  }

  const widgetConfig = session
    ? {
      backendBaseUrl,
      apiKey,
      deviceUuid: session.uuid,
      livePreviewSocketUrl: session.websocketUrl,
      livePreviewToken: session.token,
    }
    : {
      backendBaseUrl,
      apiKey,
      deviceUuid: initialConfig.deviceUuid,
      livePreviewSocketUrl: initialConfig.livePreviewSocketUrl,
      livePreviewToken: initialConfig.livePreviewToken,
    }

  return (
    <main className="min-h-screen bg-background">
      {/* Config Header */}
      <section className="border-b bg-card/70 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Eye Tracker Setup</h1>
            <p className="text-sm text-muted-foreground">
              Complete the 5-step calibration to enable gaze control across LMS, PDF Viewer, and Tasks.
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex gap-2 text-xs text-muted-foreground">
            {["Source", "ROI", "Eye Model", "Thresholds", "Mode"].map((step, i) => (
              <span key={step} className="flex items-center gap-1">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                {step}
                {i < 4 && <span className="text-border">→</span>}
              </span>
            ))}
          </div>

          {/* Session form */}
          <form
            className="grid gap-3 lg:grid-cols-[1.1fr_1.1fr_1.3fr_auto]"
            onSubmit={(e) => void handleIssueSession(e)}
          >
            <label className="space-y-1 text-sm">
              <span className="font-medium">Backend URL</span>
              <input
                value={backendBaseUrl}
                onChange={(e) => setBackendBaseUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">API Key</span>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste API key"
                type="password"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy || !backendBaseUrl.trim() || !email.trim() || !apiKey.trim()}
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "Issuing..." : session ? "Reissue" : "Start"}
              </button>
            </div>
          </form>

          {error && (
            <p className="rounded-md border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {session && (
            <div className="grid gap-2 rounded-md border bg-background p-4 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-foreground/70">Email</div>
                <div className="font-medium text-foreground">{session.email}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-foreground/70">UUID</div>
                <div className="font-mono text-foreground">{session.uuid}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-foreground/70">Expires</div>
                <div className="text-foreground">{new Date(session.expiresAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-foreground/70">WebSocket</div>
                <div className="font-mono text-foreground break-all text-xs">
                  {session.websocketUrl ?? "auto-resolved"}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* The full widget with all 5 steps */}
      <GazeCoreWidget {...widgetConfig} />

      {/* Done button — redirect to features after calibration */}
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