"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { useSession } from "@/lib/auth-client"
import { useGazeCoreSetupWidget, type LivePreviewPoint } from "@/hooks/use-gaze-core-setup"
import { buildLivePreviewSocketUrl } from "@/lib/gaze/gaze-core-widget-backend/routes"
import { getGazeCoreDemoConfig } from "@/lib/gaze/gaze-core-demo-config"
import { testEyeTrackerStorage } from "@/lib/gaze/gaze-core-widget-storage"

type EyeTokenPayload = {
  token: string
  uuid?: string
  websocketUrl?: string
}

type GazeRouteSession = {
  token: string
  uuid: string
  websocketUrl?: string
}

type UseGazeActionNavigationOptions = {
  actionSelector?: string
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

export function useGazeActionNavigation(options: UseGazeActionNavigationOptions = {}) {
  const actionSelector = options.actionSelector ?? "[data-gaze-action-id]"
  const initialConfig = getGazeCoreDemoConfig()
  const backendBaseUrl = normalizeBaseUrl(initialConfig.appBackendBaseUrl)
  const fallbackSocketUrl = buildLivePreviewSocketUrl(initialConfig.gazeCoreBackendBaseUrl)

  const { data: authSession, isPending: authPending } = useSession()
  const recoveryAttemptedRef = useRef(false)

  const [routeSession, setRouteSession] = useState<GazeRouteSession | null>(null)
  const [authError, setAuthError] = useState("")
  const [sessionBusy, setSessionBusy] = useState(false)
  const [cursorPosition, setCursorPosition] = useState({ x: -100, y: -100 })
  const [calibrationReady, setCalibrationReady] = useState(readCalibrationReady)
  const [activeActionId, setActiveActionId] = useState<string | null>(null)

  const handleLivePreviewPoint = useCallback((point: LivePreviewPoint | null) => {
    if (!point) return
    const viewportPoint = toViewportPoint(point)
    setCursorPosition({ x: viewportPoint.x, y: viewportPoint.y })
  }, [])

  const gazeState = useGazeCoreSetupWidget({
    backendBaseUrl,
    deviceUuid: routeSession?.uuid,
    livePreviewSocketUrl: routeSession?.websocketUrl ?? fallbackSocketUrl,
    livePreviewToken: routeSession?.token,
    onLivePreviewPoint: handleLivePreviewPoint,
  })

  const gazeControlEnabled = Boolean(routeSession) && calibrationReady

  const fetchEyeToken = useCallback(async (fallbackUuid: string) => {
    const candidateEndpoints = buildTokenEndpointCandidates(backendBaseUrl)
    let latestError = "Unable to initialize gaze navigation session."

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
          } satisfies GazeRouteSession
        }

        latestError = extractErrorMessage(payload, latestError)
      } catch (caughtError) {
        latestError = caughtError instanceof Error ? caughtError.message : latestError
      }
    }

    throw new Error(latestError)
  }, [backendBaseUrl])

  const refreshSession = useCallback(async () => {
    if (!authSession?.user?.id) return

    setSessionBusy(true)
    setAuthError("")
    try {
      const nextSession = await fetchEyeToken(authSession.user.id)
      setRouteSession(nextSession)
    } catch (caughtError) {
      setAuthError(caughtError instanceof Error ? caughtError.message : "Unable to refresh gaze navigation session.")
    } finally {
      setSessionBusy(false)
    }
  }, [authSession?.user?.id, fetchEyeToken])

  useEffect(() => {
    if (authPending) return

    const userId = authSession?.user?.id
    if (!userId) {
      setRouteSession(null)
      setAuthError("")
      setSessionBusy(false)
      return
    }

    let cancelled = false

    async function init() {
      setSessionBusy(true)
      setAuthError("")
      try {
        const eyeSession = await fetchEyeToken(userId)
        if (cancelled) return
        setRouteSession(eyeSession)
      } catch (caughtError) {
        if (cancelled) return
        setAuthError(caughtError instanceof Error ? caughtError.message : "Failed to initialize gaze navigation session.")
      } finally {
        if (!cancelled) {
          setSessionBusy(false)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [authSession?.user?.id, authPending, fetchEyeToken])

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
    void refreshSession()
  }, [gazeControlEnabled, gazeState.livePreviewError, gazeState.livePreviewStatus, refreshSession, sessionBusy])

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

    setActiveActionId(null)
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
      setActiveActionId(null)
      return
    }

    const element = document.elementFromPoint(cursorPosition.x, cursorPosition.y)
    const focusElement = element?.closest<HTMLElement>(actionSelector)
    setActiveActionId(focusElement?.dataset.gazeActionId ?? null)
  }, [actionSelector, cursorPosition, gazeControlEnabled, gazeState.livePreviewActive])

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

      if (!activeActionId) return

      const actionElement = document.querySelector<HTMLElement>(`[data-gaze-action-id="${activeActionId}"]`)
      if (!actionElement) return

      event.preventDefault()
      actionElement.click()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [activeActionId, gazeControlEnabled])

  return {
    authPending,
    signedIn: Boolean(authSession?.user?.id),
    userEmail: authSession?.user?.email ?? "",
    authError,
    sessionBusy,
    calibrationReady,
    gazeControlEnabled,
    livePreviewActive: gazeState.livePreviewActive,
    livePreviewStatus: gazeState.livePreviewStatus,
    livePreviewError: gazeState.livePreviewError,
    cursorPosition,
    activeActionId,
    isActionFocused: (actionId: string) => gazeControlEnabled && activeActionId === actionId,
    refreshSession,
  }
}
