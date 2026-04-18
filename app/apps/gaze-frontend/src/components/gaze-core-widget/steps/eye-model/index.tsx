// eslint-disable @typescript-eslint/no-explicit-any
import { Button } from "../../button"
import { SectionCard } from "../../SectionCard"
import type { GazeCoreWidgetState } from "../../types"

export function EyeModelStep({ state }: { state: GazeCoreWidgetState }) {
  if (state.currentStep !== "eyeModel") return null

  return (
    <SectionCard title="Eye Sphere Setup">
      <p className="text-sm text-muted-foreground">
        Place two points on the eye preview. Midpoint becomes sphere center and points define the diameter.
      </p>

      <div className="rounded-md border p-3 text-sm">
        <p className="font-medium">
          Next click target: {state.eyeCornerTarget === "inner" ? "Inner corner" : "Outer corner"}
        </p>
        <p className="mt-2 text-muted-foreground">
          Inner: {state.eyeCorners.inner ? `${state.eyeCorners.inner[0]}, ${state.eyeCorners.inner[1]}` : "Not selected"}
        </p>
        <p className="text-muted-foreground">
          Outer: {state.eyeCorners.outer ? `${state.eyeCorners.outer[0]}, ${state.eyeCorners.outer[1]}` : "Not selected"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={state.eyeCornerTarget === "inner" ? "default" : "outline"} onClick={() => state.setEyeCornerTarget("inner")}>
          Pick Inner Corner
        </Button>
        <Button variant={state.eyeCornerTarget === "outer" ? "default" : "outline"} onClick={() => state.setEyeCornerTarget("outer")}>
          Pick Outer Corner
        </Button>
        <Button variant="outline" onClick={() => state.setEyeCorners({ inner: null, outer: null })}>
          Clear Points
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Inner X</span>
          <input
            type="number"
            value={state.eyeCorners.inner?.[0] ?? 0}
            onChange={(event) =>

              state.setEyeCorners((prev) => ({
                ...prev,
                inner: [Number(event.target.value), prev.inner?.[1] ?? 0],
              }))
            }
            className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/50"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Inner Y</span>
          <input
            type="number"
            value={state.eyeCorners.inner?.[1] ?? 0}
            onChange={(event) =>
              state.setEyeCorners((prev) => ({
                ...prev,
                inner: [prev.inner?.[0] ?? 0, Number(event.target.value)],
              }))
            }
            className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/50"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Outer X</span>
          <input
            type="number"
            value={state.eyeCorners.outer?.[0] ?? 0}
            onChange={(event) =>
              state.setEyeCorners((prev) => ({
                ...prev,
                outer: [Number(event.target.value), prev.outer?.[1] ?? 0],
              }))
            }
            className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/50"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Outer Y</span>
          <input
            type="number"
            value={state.eyeCorners.outer?.[1] ?? 0}
            onChange={(event) =>
              state.setEyeCorners((prev) => ({
                ...prev,
                outer: [prev.outer?.[0] ?? 0, Number(event.target.value)],
              }))
            }
            className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/50"
          />
        </label>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => state.goToStep("roi")}>Back</Button>
        <Button onClick={() => state.goToStep("thresholds")} disabled={!state.eyeCorners.inner || !state.eyeCorners.outer}>
          Next: Thresholds
        </Button>
      </div>
    </SectionCard>
  )
}


