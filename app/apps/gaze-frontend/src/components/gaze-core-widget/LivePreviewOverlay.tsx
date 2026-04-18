import { Button } from "./button"
import type { GazeCoreWidgetState } from "./types"

export function LivePreviewOverlay({ state }: { state: GazeCoreWidgetState }) {
  if (!state.livePreviewActive) return null

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[1px]">
      <div className="absolute left-4 top-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
        <p>Live preview</p>
        <p className="text-xs text-white/70">Status: {state.livePreviewStatus}</p>
        {state.livePreviewError && <p className="mt-1 text-xs text-red-300">{state.livePreviewError}</p>}
      </div>

      {state.livePreviewPoint && (
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]"
          style={{ left: state.livePreviewPoint.x, top: state.livePreviewPoint.y }}
        />
      )}

      <Button className="absolute right-4 top-4" variant="secondary" onClick={state.stopLivePreview}>
        Stop live preview
      </Button>
    </div>
  )
}
