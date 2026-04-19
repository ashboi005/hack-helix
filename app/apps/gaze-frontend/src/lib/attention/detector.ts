import type { CoordinateSample, DetectionMetrics, DetectionResult, ScrollSample } from "./types"

/**
 * LINE-SEGMENT STATE MACHINE DETECTOR
 *
 * Quantizes cursor Y into text-line bands and analyses transitions between
 * lines to determine reading state.  See the original design notes in the
 * previous version for the full rationale.
 *
 * Detection signals:
 *  • Reading   — cursor progresses forward through lines (LTR then next line)
 *  • Rereading — cursor backtracks on the same line or returns to earlier lines
 *  • Distraction — big line jumps OR rapid oscillation between different lines
 *  • Scanning  — fast scroll-wheel velocity
 */

const LINE_HEIGHT_PX = 28
const Y_JITTER_PX = 20
const SAME_LINE_BACKTRACK_PX = 12
const WITHIN_SEGMENT_BACKTRACK_PX = 16
const SAMPLE_BACKTRACK_PX = 6

// ────────────────────────── Public API ──────────────────────────

export function detectAttentionMode(
  samples: CoordinateSample[],
  scrollSamples: ScrollSample[],
): DetectionResult {
  const scrollVelocity = normalizeScroll(scrollSamples)

  if (samples.length < 6) {
    return { mode: "reading", metrics: emptyMetrics(scrollVelocity) }
  }

  const segments = buildLineSegments(samples)
  if (segments.length < 2) {
    return { mode: "reading", metrics: emptyMetrics(scrollVelocity) }
  }

  // ── Classify every transition between consecutive segments ──

  let forwards = 0
  let sameLineContinue = 0
  let sameLineReread = 0
  let backward = 0
  let bigJump = 0
  let pageChange = 0
  const totalTransitions = segments.length - 1

  for (let i = 1; i < segments.length; i++) {
    const kind = classifyTransition(segments[i - 1], segments[i])
    switch (kind) {
      case "forward":
        forwards++
        break
      case "same-line-continue":
        sameLineContinue++
        break
      case "same-line-reread":
        sameLineReread++
        break
      case "backward":
        backward++
        break
      case "big-jump":
        bigJump++
        break
      case "page-change":
        pageChange++
        break
    }
  }

  // ── Direction oscillation ──
  // Ignore tiny Y jitter so slight deflections do not look like distraction.
  const meaningfulDirections: number[] = []
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]
    const curr = segments[i]
    const dy = curr.yStart - prev.yEnd
    const lineDelta = curr.lineIndex - prev.lineIndex
    if (Math.abs(dy) <= Y_JITTER_PX || lineDelta === 0) continue
    meaningfulDirections.push(Math.sign(lineDelta))
  }

  let directionChanges = 0
  for (let i = 1; i < meaningfulDirections.length; i++) {
    if (meaningfulDirections[i] !== meaningfulDirections[i - 1]) {
      directionChanges++
    }
  }

  const oscillationRatio =
    meaningfulDirections.length >= 4
      ? directionChanges / (meaningfulDirections.length - 1)
      : 0

  // ── Within-segment X reversals ──
  let withinLineReversals = 0
  for (const seg of segments) {
    if (seg.xMax - seg.xEnd > WITHIN_SEGMENT_BACKTRACK_PX && seg.sampleCount > 3) {
      withinLineReversals++
    }
  }

  // Count immediate same-line negative X movement from the current point.
  // This improves reread detection without waiting for long segment resets.
  let sampleLevelBacktracks = 0
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]
    const curr = samples[i]
    if (prev.pageNumber !== curr.pageNumber) continue
    if (Math.abs(curr.y - prev.y) > Y_JITTER_PX) continue
    if (curr.x < prev.x - SAMPLE_BACKTRACK_PX) {
      sampleLevelBacktracks++
    }
  }

  const EPS = 0.0001

  const forwardRatio =
    (forwards + sameLineContinue) / (totalTransitions + EPS)

  // Rereading — count same-line backtracks, backward transitions and within-line reversals
  // Denominator is just totalTransitions so it's directly comparable to forwardRatio
  const baseRereadRatio =
    (sameLineReread + backward + withinLineReversals) / (totalTransitions + EPS)
  const sampleBacktrackRatio = sampleLevelBacktracks / (samples.length - 1 + EPS)
  const rereadRatio = Math.min(1, baseRereadRatio + sampleBacktrackRatio * 0.6)

  // Distraction — big jumps + oscillation combined
  const bigJumpRatio = bigJump / (totalTransitions + EPS)
  const erraticRatio = Math.max(bigJumpRatio, oscillationRatio)

  const metrics: DetectionMetrics = {
    leftToRightRatio: forwardRatio,
    rightToLeftRatio: rereadRatio,
    lineResetCount: forwards,
    erraticRatio,
    verticalSweepRatio: pageChange / (totalTransitions + EPS),
    meanAbsDy: 0,
    netVerticalProgress: 0,
    scrollVelocity,
  }

  // ── Decision tree ──

  // 1. Distraction: lots of big jumps OR rapid line-oscillation
  if (erraticRatio > 0.30) {
    return { mode: "distraction", metrics }
  }

  // 2. Rereading: significant same-line backtracks or backward transitions
  //    BUT only if forward ratio isn't dominating — this prevents "sticky" rereading
  if (rereadRatio > 0.20 && rereadRatio > forwardRatio * 0.5) {
    return { mode: "rereading", metrics }
  }

  // 3. Scanning: fast scroll-wheel velocity
  if (scrollVelocity > 2.2) {
    return { mode: "scanning", metrics }
  }

  // 4. Reading: decent forward progress
  if (forwardRatio > 0.30) {
    return { mode: "reading", metrics }
  }

  // 5. Fallback
  return forwardRatio >= rereadRatio
    ? { mode: "reading", metrics }
    : { mode: "scanning", metrics }
}

// ──────────────────────── Line segments ────────────────────────

type LineSegment = {
  lineIndex: number
  pageNumber: number
  xStart: number
  xEnd: number
  xMax: number
  yStart: number
  yEnd: number
  startTs: number
  endTs: number
  sampleCount: number
}

function buildLineSegments(samples: CoordinateSample[]): LineSegment[] {
  const raw: LineSegment[] = []
  let curr: LineSegment | null = null

  for (const s of samples) {
    const line = Math.floor(s.y / LINE_HEIGHT_PX)

    if (!curr || curr.lineIndex !== line || curr.pageNumber !== s.pageNumber) {
      if (curr) raw.push(curr)
      curr = {
        lineIndex: line,
        pageNumber: s.pageNumber,
        xStart: s.x,
        xEnd: s.x,
        xMax: s.x,
        yStart: s.y,
        yEnd: s.y,
        startTs: s.ts,
        endTs: s.ts,
        sampleCount: 1,
      }
    } else {
      curr.xEnd = s.x
      curr.xMax = Math.max(curr.xMax, s.x)
      curr.yEnd = s.y
      curr.endTs = s.ts
      curr.sampleCount++
    }
  }
  if (curr) raw.push(curr)

  return mergeShortSegments(raw)
}

function mergeShortSegments(segments: LineSegment[]): LineSegment[] {
  if (segments.length < 3) return segments

  const merged: LineSegment[] = [segments[0]]

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    const prev = merged[merged.length - 1]

    if (
      seg.sampleCount < 3 &&
      Math.abs(seg.lineIndex - prev.lineIndex) <= 1 &&
      seg.pageNumber === prev.pageNumber
    ) {
      prev.xEnd = seg.xEnd
      prev.xMax = Math.max(prev.xMax, seg.xMax)
      prev.yEnd = seg.yEnd
      prev.endTs = seg.endTs
      prev.sampleCount += seg.sampleCount
    } else {
      merged.push(seg)
    }
  }

  return merged
}

// ────────────────── Transition classification ──────────────────

type TransitionKind =
  | "forward"
  | "same-line-continue"
  | "same-line-reread"
  | "backward"
  | "big-jump"
  | "page-change"

function classifyTransition(prev: LineSegment, curr: LineSegment): TransitionKind {
  if (prev.pageNumber !== curr.pageNumber) return "page-change"

  const lineDiff = curr.lineIndex - prev.lineIndex
  const dy = curr.yStart - prev.yEnd

  if (Math.abs(dy) <= Y_JITTER_PX) {
    return curr.xStart < prev.xEnd - SAME_LINE_BACKTRACK_PX ? "same-line-reread" : "same-line-continue"
  }

  if (lineDiff === 0) {
    return curr.xStart < prev.xEnd - SAME_LINE_BACKTRACK_PX ? "same-line-reread" : "same-line-continue"
  }

  // 2+ lines in either direction is a big jump
  if (Math.abs(lineDiff) >= 2 && Math.abs(dy) >= LINE_HEIGHT_PX * 1.4) return "big-jump"

  // 1 line down = reading forward
  if (lineDiff > 0) return "forward"

  // 1 line up = rereading
  return "backward"
}

// ──────────────────────── Helpers ──────────────────────────────

function normalizeScroll(scrollSamples: ScrollSample[]): number {
  if (!scrollSamples.length) return 0
  const recent = scrollSamples.slice(-40)
  const absDelta = recent.reduce((sum, s) => sum + Math.abs(s.deltaY), 0)
  const firstTs = recent[0]?.ts ?? Date.now()
  const lastTs = recent[recent.length - 1]?.ts ?? firstTs
  return absDelta / Math.max(1, lastTs - firstTs)
}

function emptyMetrics(scrollVelocity: number): DetectionMetrics {
  return {
    leftToRightRatio: 0,
    rightToLeftRatio: 0,
    lineResetCount: 0,
    erraticRatio: 0,
    verticalSweepRatio: 0,
    meanAbsDy: 0,
    netVerticalProgress: 0,
    scrollVelocity,
  }
}
