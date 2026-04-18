import type { GazeCoreWidgetState } from "./types"

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
            {step}
          </div>
        ))}
      </div>
    </div>
  )
}



