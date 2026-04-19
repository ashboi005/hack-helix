export type AttentionMode = "reading" | "rereading" | "scanning" | "distraction"

export type CoordinateSource = "eye" | "cursor"

export type CoordinateSample = {
  x: number
  y: number
  ts: number
  source: CoordinateSource
  pageNumber: number
}

export type ScrollSample = {
  deltaY: number
  ts: number
}

export type DetectionMetrics = {
  leftToRightRatio: number
  rightToLeftRatio: number
  lineResetCount: number
  erraticRatio: number
  verticalSweepRatio: number
  meanAbsDy: number
  netVerticalProgress: number
  scrollVelocity: number
}

export type DetectionResult = {
  mode: AttentionMode
  metrics: DetectionMetrics
}

export type RegionImagePayload = {
  imageBase64: string
  pageNumber: number
}

export type CheckDistractionCoordinate = {
  x: number
  y: number
  ts: number
  source?: CoordinateSource
  pageNumber?: number
}

export type CheckDistractionRequest = {
  docId: string
  fullPageBase64: string
  fullPagePageNumber: number
  regionImages: RegionImagePayload[]
  pageNumbers: number[]
  recentCoordinates: CheckDistractionCoordinate[]
}
