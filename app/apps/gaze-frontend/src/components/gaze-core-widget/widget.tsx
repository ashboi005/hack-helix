import { useGazeCoreSetupWidget } from "../../hooks/use-gaze-core-setup"
import type { GazeCoreWidgetProps, GazeCoreWidgetState } from "./types"
import { CalibrationOverlay } from "./CalibrationOverlay"
import { LivePreviewOverlay } from "./LivePreviewOverlay"
import { GazeCoreWidgetPanel } from "./PreviewCanvasPanel"
import { GazeCoreWidgetEntry } from "./StepProgress"
import { LiveDataStep } from "./steps/live-data"
import { ModeStep } from "./steps/mode"
import { EyeModelStep } from "./steps/eye-model"
import { RoiStep } from "./steps/roi"
import { SourceStep } from "./steps/source"
import { ThresholdsStep } from "./steps/thresholds"

export function GazeCoreWidget(props: GazeCoreWidgetProps = {}) {
  const state = useGazeCoreSetupWidget(props)
  return <GazeCoreWidgetView state={state} />
}

export function GazeCoreWidgetView({ state }: { state: GazeCoreWidgetState }) {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-6 py-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-lg font-semibold">GazeCore Setup Widget</h1>
            <p className="text-sm text-muted-foreground">
              Same calibration setup flow as GazeConnect, using only the local UI package in-browser.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Component path: <code>@workspace/ui/components/gaze-core-widget</code>
          </div>
        </div>
      </header>

      <CalibrationOverlay state={state} />
      <LivePreviewOverlay state={state} />
      <GazeCoreWidgetEntry state={state} />

      <div className="flex flex-1 flex-col gap-6 p-6 lg:flex-row">
        <GazeCoreWidgetPanel state={state} />

        <div className="flex flex-1 flex-col gap-4">
          <SourceStep state={state} />
          <RoiStep state={state} />
          <EyeModelStep state={state} />
          <ThresholdsStep state={state} />
          <ModeStep state={state} />
          <LiveDataStep state={state} />
        </div>
      </div>
    </main>
  )
}
