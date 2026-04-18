import type { GazeCoreWidgetState } from "../../types"

export function LiveDataStep({ state }: { state: GazeCoreWidgetState }) {
  const trackingStatus =
    state.livePreviewStatus === "connected"
      ? "active"
      : state.livePreviewStatus === "connecting"
        ? "starting"
        : "idle"

  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">Setup Health</h2>
      </header>
      <div className="space-y-2 px-4 py-4 text-sm text-muted-foreground">
        <p>
          Camera preview: <span className="font-medium text-foreground">{state.previewActive ? "running" : "stopped"}</span>
        </p>
        <p>
          Calibration: <span className="font-medium text-foreground">{state.gyroZeroReady ? "ready" : "incomplete"}</span>
        </p>
        <p>
          Live tracking: <span className="font-medium text-foreground">{trackingStatus}</span>
        </p>
      </div>
    </section>
  )
}
