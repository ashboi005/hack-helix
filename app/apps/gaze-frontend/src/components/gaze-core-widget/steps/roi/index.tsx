import { Button } from "../../button"
import { SectionCard } from "../../SectionCard"
import type { GazeCoreWidgetState } from "../../types"

export function RoiStep({ state }: { state: GazeCoreWidgetState }) {
  if (state.currentStep !== "roi") return null

  return (
    <SectionCard title="Region Of Interest">
      <p className="text-sm text-muted-foreground">Drag the corner handles on the left preview to adjust the region.</p>
      <div className="grid grid-cols-2 gap-3">
        {( ["x", "y", "width", "height"] as const ).map((field) => (
          <label key={field} className="space-y-1 text-sm">
            <span className="font-medium capitalize">{field}</span>
            <input
              type="number"
              value={state.roi[field]}
              onChange={(event) => {
                state.setRoi({
                  ...state.roi,
                  [field]: Number(event.target.value),
                })
              }}
              onBlur={state.pushUpdate}
              className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/50"
            />
          </label>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => state.goToStep("source")}>Back</Button>
        <Button onClick={() => state.goToStep("eyeModel")}>Next: Eye Model</Button>
      </div>
    </SectionCard>
  )
}


