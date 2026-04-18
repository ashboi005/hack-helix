import { Button } from "../../button"
import { SectionCard } from "../../SectionCard"
import type { GazeCoreWidgetState } from "../../types"

export function SourceStep({ state }: { state: GazeCoreWidgetState }) {
  if (state.currentStep !== "source") return null

  return (
    <SectionCard title="Camera Source">
      <div className="space-y-1">
        <p className="text-sm font-medium">Camera type</p>
        <div className="flex gap-2">
          <Button variant={state.kind === "usb" ? "default" : "outline"} onClick={() => state.setKind("usb")}>USB Camera</Button>
          <Button variant={state.kind === "network" ? "default" : "outline"} onClick={() => state.setKind("network")}>Network Stream</Button>
        </div>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">{state.kind === "usb" ? "Camera index or device id" : "Stream URL"}</span>
        <input
          value={state.source}
          onChange={(event) => state.setSource(event.target.value)}
          placeholder={state.kind === "usb" ? "0" : "https://example.com/stream.m3u8"}
          className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/50"
        />
      </label>

      <div className="flex gap-2">
        {!state.previewActive ? (
          <Button onClick={() => void state.openPreview()}>Start Preview</Button>
        ) : (
          <Button variant="outline" onClick={state.closePreview}>Stop Preview</Button>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={() => state.goToStep("roi")} disabled={!state.previewActive}>
          Next: Set ROI
        </Button>
      </div>
    </SectionCard>
  )
}


