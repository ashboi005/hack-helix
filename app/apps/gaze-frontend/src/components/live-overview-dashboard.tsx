"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Space_Grotesk } from "next/font/google"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { signOut, useSession } from "@/lib/auth-client"
import { buildLivePreviewSocketUrl } from "@/lib/gaze/gaze-core-widget-backend/routes"
import { getGazeCoreDemoConfig } from "@/lib/gaze/gaze-core-demo-config"
import { testEyeTrackerStorage } from "@/lib/gaze/gaze-core-widget-storage"
import { useGazeCoreSetupWidget, type LivePreviewPoint } from "@/hooks/use-gaze-core-setup"
import { cn } from "@/lib/utils"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

type LiveOverviewCard = {
  id: string
  title: string
  subtitle: string
  description: string
  href: string
  accent: string
}

type EyeTokenPayload = {
  token: string
  uuid?: string
  websocketUrl?: string
}

type LiveOverviewSession = {
  token: string
  uuid: string
  websocketUrl?: string
}

const overviewCards: LiveOverviewCard[] = [
  {
    id: "overview-lms",
    title: "LMS",
    subtitle: "YouTube Learning",
    description: "Open learning mode and continue your guided lessons.",
    href: "/youtube",
    accent: "from-rose-400/35 to-orange-500/20",
  },
  {
    id: "overview-pdf",
    title: "PDF Viewer",
    subtitle: "Document Workspace",
    description: "Read, scan, and continue document tasks with live gaze input.",
    href: "/pdf",
    accent: "from-blue-400/35 to-cyan-500/20",
  },
  {
    id: "overview-setup",
    title: "Setup",
    subtitle: "Calibration",
    description: "Run calibration and gyro snapshot before live control sessions.",
    href: "/calibrate",
    accent: "from-emerald-400/35 to-teal-500/20",
  },
  {
    id: "overview-appliance",
    title: "Appliance Control",
    subtitle: "Device Actions",
    description: "Manage appliances and launch control workflows.",
    href: "/appliance",
    accent: "from-violet-400/35 to-indigo-500/20",
  },
]

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

function extractEyeTokenPayload(payload: unknown): EyeTokenPayload | null {
  if (!payload || typeof payload !== "object") return null

  const record = payload as Record<string, unknown>
  const nested = record.data && typeof record.data === "object"
    ? (record.data as Record<string, unknown>)
    : null

  const token = typeof record.token === "string"
    ? record.token
    : nested && typeof nested.token === "string"
      ? nested.token
      : null

  if (!token?.trim()) return null

  const uuid = typeof record.uuid === "string"
    ? record.uuid
    : nested && typeof nested.uuid === "string"
      ? nested.uuid
      : undefined

  const websocketUrl = typeof record.websocketUrl === "string"
    ? record.websocketUrl
    : nested && typeof nested.websocketUrl === "string"
      ? nested.websocketUrl
      : undefined

  return {
    token,
    uuid,
    websocketUrl,
  }
}

function buildTokenEndpointCandidates(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl)
  const candidates = [
    new URL("/eye/token", `${normalized}/`).toString(),
    "/eye/token",
    new URL("/api/gaze/token", `${normalized}/`).toString(),
    "/api/gaze/token",
  ]

  return Array.from(new Set(candidates))
}

function toViewportPoint(point: LivePreviewPoint): LivePreviewPoint {
  if (typeof window === "undefined") return point

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const nextX = point.x >= 0 && point.x <= 1 ? point.x * viewportWidth : point.x
  const nextY = point.y >= 0 && point.y <= 1 ? point.y * viewportHeight : point.y

  return {
    ...point,
    x: Math.min(viewportWidth, Math.max(0, nextX)),
    y: Math.min(viewportHeight, Math.max(0, nextY)),
  }
}

function readCalibrationReady() {
  try {
    const calibrationRecord = testEyeTrackerStorage.readCalibrationRecord()
    return Boolean(calibrationRecord?.calibration && calibrationRecord.gyroZeroSnapshot)
  } catch {
    return false
  }
}

export function LiveOverviewDashboard() {
  const router = useRouter()

  const initialConfig = getGazeCoreDemoConfig()
  const backendBaseUrl = normalizeBaseUrl(initialConfig.appBackendBaseUrl)
  const fallbackSocketUrl = buildLivePreviewSocketUrl(initialConfig.gazeCoreBackendBaseUrl)

  const { data: authSession, isPending: authPending } = useSession()
  const recoveryAttemptedRef = useRef(false)

  const [overviewSession, setOverviewSession] = useState<LiveOverviewSession | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [authError, setAuthError] = useState("")
  const [signoutBusy, setSignoutBusy] = useState(false)

  const [cursorPosition, setCursorPosition] = useState({ x: -100, y: -100 })
  const [calibrationReady, setCalibrationReady] = useState(readCalibrationReady)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const handleLivePreviewPoint = useCallback((point: LivePreviewPoint | null) => {
    if (!point) return
    const viewportPoint = toViewportPoint(point)
    setCursorPosition({ x: viewportPoint.x, y: viewportPoint.y })
  }, [])

  const gazeState = useGazeCoreSetupWidget({
    backendBaseUrl,
    deviceUuid: overviewSession?.uuid,
    livePreviewSocketUrl: overviewSession?.websocketUrl ?? fallbackSocketUrl,
    livePreviewToken: overviewSession?.token,
    onLivePreviewPoint: handleLivePreviewPoint,
  })

  const cardsById = useMemo(() => {
    return new Map(overviewCards.map((card) => [card.id, card]))
  }, [])

  const gazeControlEnabled = Boolean(overviewSession) && calibrationReady

  const fetchEyeToken = useCallback(async (fallbackUuid: string) => {
    const candidateEndpoints = buildTokenEndpointCandidates(backendBaseUrl)
    let latestError = "Unable to initialize live overview session."

    for (const endpoint of candidateEndpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
        })

        const payload = await response.json().catch(() => null) as EyeTokenPayload | Record<string, unknown> | null
        const tokenPayload = extractEyeTokenPayload(payload)

        if (response.ok && tokenPayload) {
          return {
            token: tokenPayload.token,
            uuid: typeof tokenPayload.uuid === "string" && tokenPayload.uuid.trim() ? tokenPayload.uuid : fallbackUuid,
            websocketUrl: typeof tokenPayload.websocketUrl === "string" && tokenPayload.websocketUrl.trim() ? tokenPayload.websocketUrl : undefined,
          } satisfies LiveOverviewSession
        }

        latestError = extractErrorMessage(payload, latestError)
      } catch (caughtError) {
        latestError = caughtError instanceof Error ? caughtError.message : latestError
      }
    }

    throw new Error(latestError)
  }, [backendBaseUrl])

  const refreshOverviewSession = useCallback(async () => {
    if (!authSession?.user?.id) return

    setSessionBusy(true)
    setAuthError("")
    try {
      const nextSession = await fetchEyeToken(authSession.user.id)
      setOverviewSession(nextSession)
    } catch (caughtError) {
      setAuthError(caughtError instanceof Error ? caughtError.message : "Unable to refresh live overview session.")
    } finally {
      setSessionBusy(false)
    }
  }, [authSession?.user?.id, fetchEyeToken])

  useEffect(() => {
    if (authPending) return

    const userId = authSession?.user?.id ?? ""

    if (!userId) {
      setAuthChecked(true)
      router.replace("/login?next=/")
      return
    }

    let cancelled = false

    async function init() {
      setSessionBusy(true)
      setAuthError("")
      try {
        const eyeSession = await fetchEyeToken(userId)
        if (cancelled) return
        setOverviewSession(eyeSession)
      } catch (caughtError) {
        if (cancelled) return
        setAuthError(caughtError instanceof Error ? caughtError.message : "Failed to initialize live overview session.")
      } finally {
        if (!cancelled) {
          setAuthChecked(true)
          setSessionBusy(false)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [authSession, authPending, fetchEyeToken, router])

  useEffect(() => {
    if (gazeState.livePreviewStatus === "connected") {
      recoveryAttemptedRef.current = false
    }
  }, [gazeState.livePreviewStatus])

  useEffect(() => {
    if (!gazeControlEnabled || sessionBusy) return
    if (gazeState.livePreviewStatus !== "error") return
    if (recoveryAttemptedRef.current) return

    const errorMessage = gazeState.livePreviewError.toLowerCase()
    const authorizationIssue =
      errorMessage.includes("authoriz")
      || errorMessage.includes("token")
      || errorMessage.includes("4401")
      || errorMessage.includes("4403")

    if (!authorizationIssue) return

    recoveryAttemptedRef.current = true
    void refreshOverviewSession()
  }, [gazeControlEnabled, gazeState.livePreviewError, gazeState.livePreviewStatus, refreshOverviewSession, sessionBusy])

  useEffect(() => {
    const syncCalibrationReady = () => {
      setCalibrationReady(readCalibrationReady())
    }

    syncCalibrationReady()
    window.addEventListener("storage", syncCalibrationReady)
    window.addEventListener("focus", syncCalibrationReady)

    return () => {
      window.removeEventListener("storage", syncCalibrationReady)
      window.removeEventListener("focus", syncCalibrationReady)
    }
  }, [])

  useEffect(() => {
    if (gazeControlEnabled) return

    setActiveCardId(null)
    gazeState.stopLivePreview()
    gazeState.closePreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled])

  useEffect(() => {
    if (!gazeControlEnabled) return
    if (gazeState.previewActive) return
    void gazeState.openPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled, gazeState.previewActive])

  useEffect(() => {
    if (!gazeControlEnabled) return
    if (!gazeState.previewActive) return
    if (gazeState.livePreviewActive) return
    void gazeState.startLivePreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeControlEnabled, gazeState.livePreviewActive, gazeState.previewActive])

  useEffect(() => {
    if (!gazeControlEnabled || !gazeState.livePreviewActive) {
      setActiveCardId(null)
      return
    }

    const element = document.elementFromPoint(cursorPosition.x, cursorPosition.y)
    const cardElement = element?.closest<HTMLElement>("[data-live-card-id]")
    setActiveCardId(cardElement?.dataset.liveCardId ?? null)
  }, [cursorPosition, gazeControlEnabled, gazeState.livePreviewActive])

  useEffect(() => {
    if (!gazeControlEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return

      const target = event.target as HTMLElement | null
      const isTypingContext = target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
      )
      if (isTypingContext) return

      event.preventDefault()

      const activeCard = activeCardId ? cardsById.get(activeCardId) : null
      if (!activeCard) return
      router.push(activeCard.href)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [activeCardId, cardsById, gazeControlEnabled, router])

  async function handleSignOut() {
    setSignoutBusy(true)
    try {
      await signOut()
      router.push("/login")
    } finally {
      setSignoutBusy(false)
    }
  }

  if (authPending || !authChecked) {
    return (
      <main className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto max-w-4xl rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          Checking authentication and preparing live overview...
        </div>
      </main>
    )
  }

  if (!authSession?.user?.id) {
    return (
      <main className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto max-w-4xl rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          Redirecting to login...
        </div>
      </main>
    )
  }

  return (
    <main className={cn(
      `${spaceGrotesk.className} relative min-h-screen overflow-hidden bg-[#040812] text-zinc-100`,
      gazeControlEnabled && gazeState.livePreviewActive && "cursor-none",
    )}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />

      {gazeControlEnabled && gazeState.livePreviewActive && (
        <span
          className="pointer-events-none fixed z-50 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]"
          style={{ left: cursorPosition.x, top: cursorPosition.y }}
        />
      )}

      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#070e1a]/90 px-4 py-3 text-xs text-zinc-300 shadow-[0_18px_32px_-28px_rgba(0,0,0,0.95)]">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-400">Live Overview</p>
            <p className="text-sm font-semibold text-zinc-100">
              {calibrationReady
                ? gazeState.livePreviewActive
                  ? "Eye tracking active"
                  : "Preparing eye tracking"
                : "Calibration required before live tracking"}
            </p>
            <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400">
              Signed in as {authSession.user.email}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshOverviewSession()}
              disabled={sessionBusy}
              className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-1.5 font-semibold uppercase tracking-[0.1em] text-zinc-100 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sessionBusy ? "Refreshing..." : "Refresh Session"}
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signoutBusy}
              className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-1.5 font-semibold uppercase tracking-[0.1em] text-zinc-100 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signoutBusy ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        </div>

        {authError && (
          <div className="mb-4 rounded-xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {authError}
          </div>
        )}

    

        <div className="grid flex-1 auto-rows-fr gap-4 md:grid-cols-2">
          {overviewCards.map((card) => {
            const isGazeFocused = gazeControlEnabled && activeCardId === card.id

            return (
              <Link
                key={card.id}
                href={card.href}
                data-live-card-id={card.id}
                className={cn(
                  "group relative flex min-h-[220px] overflow-hidden rounded-2xl border border-white/10 bg-[#070e1a]/90 p-6 shadow-[0_25px_40px_-28px_rgba(0,0,0,0.95)] transition-all duration-300 md:p-8",
                  "hover:-translate-y-1 hover:border-white/25 hover:bg-[#0d1628]",
                  isGazeFocused && "border-emerald-300/90 bg-[#0d1c22] shadow-[0_0_24px_rgba(16,185,129,0.35)]",
                )}
              >
                <div className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80 transition-opacity duration-300 group-hover:opacity-100",
                  card.accent,
                )} />
                <div className="relative flex h-full w-full flex-col justify-between gap-6">
                  <div className="space-y-4">
                    <div className="inline-flex rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200">
                      {card.subtitle}
                    </div>
                    <h2 className="text-3xl font-semibold tracking-tight text-zinc-100">{card.title}</h2>
                    <p className="text-sm leading-relaxed text-zinc-300 sm:text-base">{card.description}</p>
                  </div>
                  <span className="inline-flex w-fit items-center rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-100">
                    Open
                  </span>
                </div>
              </Link>
            )
          })}
        </div>

        {!calibrationReady && (
          <div className="mt-6 rounded-2xl border border-amber-300/35 bg-amber-500/10 p-5 text-sm text-amber-100">
            <p className="font-semibold uppercase tracking-[0.1em]">Calibration Needed</p>
            <p className="mt-2 text-amber-100/90">
              Run setup once to capture calibration and gyro zero data before starting live overview.
            </p>
            <div className="mt-4">
              <Link
                href="/calibrate"
                className="inline-flex items-center rounded-full border border-amber-100/40 bg-amber-100/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-amber-100 transition-colors hover:bg-amber-100/25"
              >
                Open Setup
              </Link>
            </div>
          </div>
        )}

        {gazeControlEnabled && (
          <div className="pointer-events-none fixed left-4 top-4 z-40 rounded bg-black/70 px-3 py-2 text-sm text-white">
            <p>Live preview</p>
            <p className="text-xs text-white/70">Status: {gazeState.livePreviewStatus}</p>
            {gazeState.livePreviewError && (
              <p className="mt-1 text-xs text-red-300">{gazeState.livePreviewError}</p>
            )}
          </div>
        )}
      </section>
    </main>
  )
}