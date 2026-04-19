import type { CoordinateSample, DetectionMetrics, DetectionResult, ScrollSample } from "./types"

const EPS = 0.0001

export function detectAttentionMode(samples: CoordinateSample[], scrollSamples: ScrollSample[]): DetectionResult {
  const metrics = buildMetrics(samples, scrollSamples)

  if (metrics.erraticRatio > 0.55 && metrics.leftToRightRatio < 0.42 && metrics.rightToLeftRatio < 0.42) {
    return { mode: "distraction", metrics }
  }

  if (metrics.rightToLeftRatio > 0.48 && metrics.meanAbsDy < 14) {
    return { mode: "rereading", metrics }
  }

  if (metrics.leftToRightRatio > 0.48 && metrics.lineResetCount >= 1 && metrics.meanAbsDy < 22) {
    return { mode: "reading", metrics }
  }

  if (metrics.verticalSweepRatio > 0.35 || metrics.scrollVelocity > 2.2) {
    return { mode: "scanning", metrics }
  }

  if (metrics.leftToRightRatio >= metrics.rightToLeftRatio) {
    return { mode: "reading", metrics }
  }

  return { mode: "scanning", metrics }
}

function buildMetrics(samples: CoordinateSample[], scrollSamples: ScrollSample[]): DetectionMetrics {
  if (samples.length < 3) {
    return {
      leftToRightRatio: 0,
      rightToLeftRatio: 0,
      lineResetCount: 0,
      erraticRatio: 0,
      verticalSweepRatio: 0,
      meanAbsDy: 0,
      scrollVelocity: normalizeScroll(scrollSamples),
    }
  }

  let ltr = 0
  let rtl = 0
  let lineResets = 0
  let erratic = 0
  let verticalSweep = 0
  let absDySum = 0
  let segmentCount = 0

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]
    const curr = samples[i]
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)

    if (dx > 2) ltr += 1
    if (dx < -2) rtl += 1
    if (dx < -18 && dy > 8) lineResets += 1

    if (adx > 42 || ady > 30) erratic += 1
    if (ady > adx * 1.2 && ady > 8) verticalSweep += 1

    absDySum += ady
    segmentCount += 1
  }

  return {
    leftToRightRatio: ltr / (segmentCount + EPS),
    rightToLeftRatio: rtl / (segmentCount + EPS),
    lineResetCount: lineResets,
    erraticRatio: erratic / (segmentCount + EPS),
    verticalSweepRatio: verticalSweep / (segmentCount + EPS),
    meanAbsDy: absDySum / (segmentCount + EPS),
    scrollVelocity: normalizeScroll(scrollSamples),
  }
}

function normalizeScroll(scrollSamples: ScrollSample[]): number {
  if (!scrollSamples.length) return 0

  const recent = scrollSamples.slice(-40)
  const absDelta = recent.reduce((sum, sample) => sum + Math.abs(sample.deltaY), 0)
  const firstTs = recent[0]?.ts ?? Date.now()
  const lastTs = recent[recent.length - 1]?.ts ?? firstTs
  const durationMs = Math.max(1, lastTs - firstTs)

  return absDelta / durationMs
}
