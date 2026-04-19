"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useGazeCoreSetupWidget, type GazeCoreWidgetOptions, type LivePreviewPoint } from "@/hooks/use-gaze-core-setup"
import { getGazeCoreDemoConfig } from "@/lib/gaze/gaze-core-demo-config"

type GazeLiveOverlayContextValue = {
  state: ReturnType<typeof useGazeCoreSetupWidget>
  configureWidget: (nextOptions: GazeCoreWidgetOptions) => void
  latestPoint: LivePreviewPoint | null
  pointHistory: LivePreviewPoint[]
}

const GazeLiveOverlayContext = createContext<GazeLiveOverlayContextValue | null>(null)

function RootLiveOverlay({ point, active }: { point: LivePreviewPoint | null; active: boolean }) {
  if (!active || !point) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[120]">
      <div
        className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-green-300 bg-green-400 shadow-[0_0_24px_rgba(74,222,128,0.85)]"
        style={{ left: point.x, top: point.y }}
      />
      <div className="absolute right-4 top-4 rounded-full bg-black/70 px-3 py-1 text-xs text-white backdrop-blur">
        Live overlay{typeof point.confidence === "number" ? ` ${(point.confidence * 100).toFixed(0)}%` : ""}
      </div>
    </div>
  )
}

function LiveOverlayControls({ state }: { state: ReturnType<typeof useGazeCoreSetupWidget> }) {
  if (!state.calibrationResult.data) return null

  return (
    <div className="fixed bottom-4 left-4 z-[121] flex max-w-[92vw] items-center gap-2 rounded-full border border-white/25 bg-black/75 px-3 py-2 text-xs text-white shadow-lg backdrop-blur pointer-events-auto">
      {!state.livePreviewActive ? (
        <button
          type="button"
          onClick={() => void state.startLivePreview()}
          disabled={!state.livePreviewReady}
          className="rounded-full bg-green-500 px-3 py-1 font-semibold text-black disabled:cursor-not-allowed disabled:bg-zinc-600 disabled:text-zinc-300"
        >
          Start Live Overlay Preview
        </button>
      ) : (
        <button
          type="button"
          onClick={state.stopLivePreview}
          className="rounded-full bg-zinc-200 px-3 py-1 font-semibold text-black"
        >
          Stop Live Overlay
        </button>
      )}

      <span className="whitespace-nowrap text-[11px] text-zinc-200">
        {state.livePreviewActive ? `Status: ${state.livePreviewStatus}` : "Overlay idle"}
      </span>
      {state.livePreviewError && (
        <span className="max-w-[34ch] truncate text-[11px] text-red-300" title={state.livePreviewError}>
          {state.livePreviewError}
        </span>
      )}
    </div>
  )
}

export function GazeLiveOverlayProvider({ children }: { children: ReactNode }) {
  const demoConfig = getGazeCoreDemoConfig()
  const [mounted, setMounted] = useState(false)
  const [widgetOptions, setWidgetOptions] = useState<GazeCoreWidgetOptions>({
    backendBaseUrl: demoConfig.appBackendBaseUrl,
    apiKey: demoConfig.apiKey,
    deviceUuid: demoConfig.deviceUuid,
    livePreviewSocketUrl: demoConfig.livePreviewSocketUrl,
    livePreviewToken: demoConfig.livePreviewToken,
  })
  const [pointHistory, setPointHistory] = useState<LivePreviewPoint[]>([])

  useEffect(() => {
    setMounted(true)
  }, [])

  const configureWidget = useCallback((nextOptions: GazeCoreWidgetOptions) => {
    setWidgetOptions((current) => ({ ...current, ...nextOptions }))
  }, [])

  const state = useGazeCoreSetupWidget({
    ...widgetOptions,
    onLivePreviewPoint: (point) => {
      widgetOptions.onLivePreviewPoint?.(point)
      setPointHistory((current) => {
        if (!point) return []
        const next = [...current, point]
        return next.slice(-240)
      })
    },
  })

  const latestPoint = pointHistory[pointHistory.length - 1] ?? state.livePreviewPoint ?? null

  const value = useMemo<GazeLiveOverlayContextValue>(() => ({
    state,
    configureWidget,
    latestPoint,
    pointHistory,
  }), [configureWidget, latestPoint, pointHistory, state])

  return (
    <GazeLiveOverlayContext.Provider value={value}>
      {children}
      {mounted && (
        <>
          <RootLiveOverlay point={latestPoint} active={state.livePreviewActive} />
          <LiveOverlayControls state={state} />
        </>
      )}
    </GazeLiveOverlayContext.Provider>
  )
}

export function useGazeLiveOverlay() {
  const context = useContext(GazeLiveOverlayContext)
  if (!context) {
    throw new Error("useGazeLiveOverlay must be used within GazeLiveOverlayProvider.")
  }

  return context
}
