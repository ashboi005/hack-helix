import type { GazeCoreWidgetState } from "../../types"

export function LiveDataStep({ state }: { state: GazeCoreWidgetState }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">Live Data</h2>
      </header>
      <div className="space-y-2 px-4 py-4 text-sm text-muted-foreground">
        <p>
          Preview: <span className="font-medium text-foreground">{state.previewActive ? "running" : "stopped"}</span>
        </p>
        <p>
          Gaze vector: <span className="font-mono text-foreground">{state.latestResult ? state.latestResult.gazeVector.map((value) => value.toFixed(4)).join(", ") : "n/a"}</span>
        </p>
        <p>
          Insider pupil value: <span className="font-mono text-foreground">{state.latestResult?.insiderPupilValue ? state.latestResult.insiderPupilValue.join(", ") : "n/a"}</span>
        </p>
        <p>
          Gyro zero snapshot: <span className="font-medium text-foreground">{state.gyroZeroReady ? "captured" : "missing"}</span>
        </p>
        <p>
          Live preview websocket: <span className="font-medium text-foreground">{state.livePreviewStatus}</span>
        </p>
      </div>
    </section>
  )
}
