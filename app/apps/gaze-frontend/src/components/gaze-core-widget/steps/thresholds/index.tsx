import { Button } from "../../button"
import { SectionCard } from "../../SectionCard"
import type { GazeCoreWidgetState } from "../../types"

export function ThresholdsStep({ state }: { state: GazeCoreWidgetState }) {
  if (state.currentStep !== "thresholds") return null

  return (
    <SectionCard title="Pupil Detection">
      <label className="block space-y-2 text-sm">
        <span className="flex items-center justify-between">
          <span className="font-medium">Pupil threshold</span>
          <span className="font-mono text-xs">{state.pupilThreshold}</span>
        </span>
        <input
          type="range"
          min={10}
          max={200}
          step={1}
          value={state.pupilThreshold}
          onChange={(event) => state.setPupilThreshold(Number(event.target.value))}
          onMouseUp={state.pushUpdate}
          className="w-full"
        />
      </label>

      <label className="block space-y-2 text-sm">
        <span className="flex items-center justify-between">
          <span className="font-medium">Pupil blur</span>
          <span className="font-mono text-xs">{state.pupilBlur}</span>
        </span>
        <input
          type="range"
          min={1}
          max={11}
          step={2}
          value={state.pupilBlur}
          onChange={(event) => state.setPupilBlur(Number(event.target.value))}
          onMouseUp={state.pushUpdate}
          className="w-full"
        />
      </label>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => state.goToStep("eyeModel")}>Back</Button>
        <Button onClick={() => state.goToStep("mode")}>Next: Calibration</Button>
      </div>
    </SectionCard>
  )
}


