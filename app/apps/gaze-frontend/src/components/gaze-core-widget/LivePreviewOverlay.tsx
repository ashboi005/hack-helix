import { Button } from "./button"
import type { GazeCoreWidgetState } from "./types"

export function LivePreviewOverlay({ state }: { state: GazeCoreWidgetState }) {
  if (!state.livePreviewActive) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-between p-4">
      <div className="pointer-events-auto rounded bg-black/70 px-3 py-2 text-sm text-white backdrop-blur">
        <p>Live preview</p>
        <p className="text-xs text-white/70">Status: {state.livePreviewStatus}</p>
        {state.livePreviewError && <p className="mt-1 text-xs text-red-300">{state.livePreviewError}</p>}
      </div>

      <Button className="pointer-events-auto" variant="secondary" onClick={state.stopLivePreview}>
        Stop live preview
      </Button>
    </div>
  )
}
