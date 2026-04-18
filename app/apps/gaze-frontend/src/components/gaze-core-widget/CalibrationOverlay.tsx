import { Button } from "./button"
import type { GazeCoreWidgetState } from "./types"

export function CalibrationOverlay({ state }: { state: GazeCoreWidgetState }) {
  if (!state.calibrating || !state.calibPoint) return null

  return (
    <div className="fixed inset-0 z-[90] select-none bg-black/70 backdrop-blur-[1px]" style={{ cursor: "none" }}>
      <div className="absolute left-4 top-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
        <p>Point {state.calibIndex + 1} / 9</p>
        <p className="text-xs text-white/60">
          {state.calibrationStatusText || (state.captureActive ? "Capturing..." : "Press Space to capture, Esc to cancel")}
        </p>
        {state.calibrationError && <p className="mt-1 text-xs text-red-300">{state.calibrationError}</p>}
      </div>

      {state.captureActive && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
          <div className="h-full bg-green-400 transition-none" style={{ width: `${state.captureProgress}%` }} />
        </div>
      )}

      <div
        className="absolute h-5 w-5 rounded-full border-4 border-yellow-400 bg-yellow-300"
        style={{
          left: state.calibPoint[0],
          top: state.calibPoint[1],
          transform: state.calibrationTargetTransform,
        }}
      />

      <Button className="absolute right-4 top-4" variant="secondary" onClick={state.stopCalibration}>
        Cancel calibration
      </Button>
    </div>
  )
}


