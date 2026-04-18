import type { GazeCoreWidgetState } from "./types"

const stepLabels: Record<string, string> = {
  source: "Source",
  roi: "ROI",
  eyeModel: "Eye Model",
  thresholds: "Thresholds",
  mode: "Mode",
}

export function GazeCoreWidgetEntry({ state }: { state: GazeCoreWidgetState }) {
  return (
    <div className="px-6 pt-4">
      <div className="flex gap-2">
        {state.steps.map((step, index) => (
          <div
            key={step}
            className={`flex-1 rounded-full py-1 text-center text-xs font-medium capitalize ${
              index < state.stepIndex
                ? "bg-primary/30 text-primary"
                : index === state.stepIndex
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {stepLabels[step] ?? step}
          </div>
        ))}
      </div>
    </div>
  )
}



