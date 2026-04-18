import type { GazeCoreWidgetState } from "./types"

export function GazeCoreWidgetPanel({ state }: { state: GazeCoreWidgetState }) {
  return (
    <div className="flex shrink-0 flex-col gap-4">
      <canvas
        ref={state.canvasRef}
        width={640}
        height={480}
        className="rounded-lg border bg-muted"
        style={{ imageRendering: "pixelated", maxWidth: "100%" }}
        onMouseDown={state.onCanvasMouseDown}
        onMouseMove={state.onCanvasMouseMove}
        onMouseUp={state.onCanvasMouseUp}
        onMouseLeave={state.onCanvasMouseUp}
      />

      {state.currentStep === "thresholds" && (
        <canvas
          ref={state.thresholdCanvasRef}
          width={640}
          height={480}
          className="rounded-lg border bg-[#050a12]"
          style={{ imageRendering: "pixelated", maxWidth: "100%" }}
        />
      )}

      {state.previewError && <p className="text-sm text-destructive">{state.previewError}</p>}
    </div>
  )
}

