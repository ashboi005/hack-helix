"use client"

import { useEffect } from "react"
import { useGazeLiveOverlay } from "../gaze-live-overlay-provider"
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
  const { state, configureWidget } = useGazeLiveOverlay()

  useEffect(() => {
    configureWidget(props)
  }, [
    configureWidget,
    props.apiKey,
    props.backendBaseUrl,
    props.deviceUuid,
    props.livePreviewSocketUrl,
    props.livePreviewToken,
    props.onCalibrationComplete,
    props.onCalibrationRecordReady,
    props.onLivePreviewPoint,
    props.onLiveResult,
  ])

  return <GazeCoreWidgetView state={state} />
}

export function GazeCoreWidgetView({ state }: { state: GazeCoreWidgetState }) {
  return (
    <main className="flex w-full flex-col bg-background">
      <CalibrationOverlay state={state} />
      <LivePreviewOverlay state={state} />
      <GazeCoreWidgetEntry state={state} />

      <div className="flex min-h-0 flex-1 items-start gap-6 overflow-x-auto p-6">
        <GazeCoreWidgetPanel state={state} />

        <div className="flex min-w-90 max-w-160 flex-1 shrink-0 flex-col gap-4">
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
