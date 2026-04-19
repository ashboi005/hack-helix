import type { CoordinateSample } from "./types"

const KEY = "focuslayer-attention-coordinates"
const WINDOW_MS = 60_000

export function readCoordinateWindow(): CoordinateSample[] {
  if (typeof window === "undefined") return []

  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as CoordinateSample[]
    if (!Array.isArray(parsed)) return []
    return trimToWindow(parsed)
  } catch {
    return []
  }
}

export function writeCoordinateWindow(samples: CoordinateSample[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(trimToWindow(samples)))
}

export function appendCoordinateSample(samples: CoordinateSample[], sample: CoordinateSample): CoordinateSample[] {
  const next = [...samples, sample]
  return trimToWindow(next)
}

export function getLastSeconds(samples: CoordinateSample[], seconds: number): CoordinateSample[] {
  if (!samples.length) return []
  const cutoff = Date.now() - Math.max(1, seconds) * 1000
  return samples.filter((sample) => sample.ts >= cutoff)
}

function trimToWindow(samples: CoordinateSample[]): CoordinateSample[] {
  if (!samples.length) return []

  const now = Date.now()
  const cutoff = now - WINDOW_MS
  const next = samples.filter((sample) => sample.ts >= cutoff)

  return next.length > 2500 ? next.slice(next.length - 2500) : next
}
