import { Button } from "../../button"
import { SectionCard } from "../../SectionCard"
import type { GazeCoreWidgetState } from "../../types"

function RequirementStatus({
  label,
  ready,
}: {
  label: string
  ready: boolean
}) {
  return (
    <div className={ready ? "rounded border border-green-300/70 bg-green-50 px-2 py-1 text-green-700" : "rounded border border-dashed px-2 py-1 text-muted-foreground"}>
      {label}: {ready ? "ready" : "missing"}
    </div>
  )
}

export function ModeStep({ state }: { state: GazeCoreWidgetState }) {
  if (state.currentStep !== "mode") return null

  return (
    <>
      <SectionCard title="Calibration">
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm font-medium">9-Point Calibration</p>
          <p className="text-sm text-muted-foreground">
            Look at each target and press Space. Capture runs for 3 seconds and uses the most common gaze vector sample for each point.
          </p>
          <Button className="w-full" onClick={state.startCalibration} disabled={state.calibrating || !state.previewActive}>
            Start Calibration
          </Button>
          <Button className="w-full" variant="outline" onClick={state.stopCalibration} disabled={!state.calibrating}>
            Stop Calibration
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => void state.captureGyroZeroSnapshot()}
            disabled={!state.calibrationResult.data || !state.gyroSnapshotConfigured || state.gyroSnapshotPending}
          >
            {state.gyroSnapshotPending ? "Capturing Gyro Zero..." : state.gyroZeroReady ? "Re-Capture Gyro Zero" : "Capture Gyro Zero"}
          </Button>
          {state.calibrationStatusText && (
            <p className="text-xs text-muted-foreground">{state.calibrationStatusText}</p>
          )}
          {state.calibrationError && (
            <p className="rounded border border-red-300/60 bg-red-50 px-2 py-1 text-xs text-red-700">
              {state.calibrationError}
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-md border border-dashed p-4 text-sm">
          <p className="text-muted-foreground">
            Live preview needs calibration JSON, a gyro zero snapshot, live gaze vectors, token authorization, and a websocket route.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <RequirementStatus label="Calibration JSON" ready={Boolean(state.calibrationResult.data)} />
            <RequirementStatus label="Gyro Zero" ready={state.gyroZeroReady} />
            <RequirementStatus label="Gaze Stream" ready={state.previewActive} />
            <RequirementStatus label="Token/Auth" ready={state.tokenAuthorizationReady} />
            <RequirementStatus label="WS Route" ready={state.livePreviewSocketRouteReady} />
            <RequirementStatus label="Live Preview" ready={state.livePreviewReady} />
          </div>
          {!state.gyroSnapshotConfigured && (
            <p className="text-xs text-muted-foreground">
              Gyro zero capture needs a backend base URL plus either an API key and device UUID or an already-issued token.
            </p>
          )}
          {state.livePreviewError && (
            <p className="rounded border border-red-300/60 bg-red-50 px-2 py-1 text-xs text-red-700">
              {state.livePreviewError}
            </p>
          )}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => state.goToStep("thresholds")}>Back</Button>
          {!state.livePreviewActive ? (
            <Button variant="secondary" onClick={state.startLivePreview} disabled={!state.livePreviewReady}>
              Start Live Preview
            </Button>
          ) : (
            <Button variant="secondary" onClick={state.stopLivePreview}>
              Stop Live Preview
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Captured Calibration JSON">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Stored in local storage under <code>gaze-core-test-calibration</code>.
          </p>
          <Button variant="outline" onClick={state.clearCalibration}>Clear JSON</Button>
        </div>
        <textarea
          readOnly
          value={state.calibrationResult.rawJson}
          placeholder="Run calibration to store the JSON here."
          className="min-h-72 w-full rounded-md border bg-black p-3 font-mono text-xs text-white outline-none"
        />
      </SectionCard>
    </>
  )
}
