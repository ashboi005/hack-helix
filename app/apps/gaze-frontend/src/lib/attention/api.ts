import { getGazeCoreDemoConfig } from "@/lib/gaze/gaze-core-demo-config"

import type { AttentionMode, CheckDistractionRequest, RegionImagePayload } from "./types"

const ACTIVE_DOC_KEY = "focuslayer-active-document-id"

type InitiateUploadBody = {
  fileName: string
  fileSizeBytes: number
}

type InitiateUploadResponse = {
  presignedUrl: string
  documentId: string
}

export type SummariseRequest = { docId: string; scope: "full" } | { docId: string; scope: "partial"; pageNumbers: number[] }
export type SummariseResponse = { summary: string }

export type SummariseLineRequest = {
  docId: string
  pageNumber: number
  regionBase64: string
}

export type SummariseLineResponse = {
  summary: string
}

export type ExplainRereadRequest = {
  docId: string
  pageNumber: number
  regionBase64: string
}

export type ExplainRereadResponse = { explanation: string }

export type CheckDistractionBackendBody = {
  docId: string
  fullPageBase64: string
  fullPagePageNumber: number
  regionImages: RegionImagePayload[]
  pageNumbers: number[]
  recentCoordinates?: CheckDistractionRequest["recentCoordinates"]
}



export type CheckDistractionResponse = {
  genuine: boolean
  reason: string
  pageNumbers: number[]
}

export type AssistancePromptAction = {
  id: "summarise" | "explain-reread" | "check-distraction"
  label: string
  description: string
}

export type DocumentSummary = {
  id: string
  fileName: string
  createdAt: string
}

const backendBaseUrl = normalizeBaseUrl(getGazeCoreDemoConfig().appBackendBaseUrl)

export async function initiateDocumentUpload(body: InitiateUploadBody): Promise<InitiateUploadResponse> {
  const response = await fetch(buildUrl("/documents/initiate-upload"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body),
  })

  return parseJsonResponse<InitiateUploadResponse>(response, "Unable to initiate upload")
}

export async function uploadPdfToPresignedUrl(url: string, file: File): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
    },
    body: file,
  })

  if (!response.ok) {
    throw new Error("Upload to storage failed")
  }
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const response = await fetch(buildUrl("/documents"), {
    credentials: "include",
  })

  return parseJsonResponse<DocumentSummary[]>(response, "Unable to fetch documents")
}

export async function getDocument(id: string): Promise<DocumentSummary> {
  const response = await fetch(buildUrl(`/documents/${id}`), {
    credentials: "include",
  })

  return parseJsonResponse<DocumentSummary>(response, "Unable to fetch document")
}

export async function requestSummary(
  input: SummariseRequest,
): Promise<SummariseResponse> {
  return summariseDocument(input)
}

export async function summariseDocument(input: SummariseRequest): Promise<SummariseResponse> {
  const response = await fetch(buildUrl("/assistance/summarise"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(input),
  })

  const payload = await parseJsonResponse<unknown>(response, "Unable to fetch summary")
  const summary = extractStringField(payload, ["summary", "data.summary", "result.summary"])

  if (!summary) {
    throw new Error("Summary response was empty")
  }

  return { summary }
}

export async function summariseLine(input: SummariseLineRequest): Promise<SummariseLineResponse> {
  const response = await fetch(buildUrl("/assistance/summarise-line"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(input),
  })

  const payload = await parseJsonResponse<unknown>(response, "Unable to summarise line")
  const summary = extractStringField(payload, ["summary", "data.summary", "result.summary"])

  if (!summary) {
    throw new Error("Line summary response was empty")
  }

  return { summary }
}

export function buildSummariseRequest(docId: string, options?: { pageNumbers?: number[] }): SummariseRequest {
  const pages = normalizePageNumbers(options?.pageNumbers ?? [])

  if (pages.length === 0) {
    return {
      docId,
      scope: "full",
    }
  }

  return {
    docId,
    scope: "partial",
    pageNumbers: pages,
  }
}

export async function explainReread(input: ExplainRereadRequest): Promise<ExplainRereadResponse> {
  return explainRereadRegion(input)
}

export async function explainRereadRegion(input: ExplainRereadRequest): Promise<ExplainRereadResponse> {
  const response = await fetch(buildUrl("/assistance/explain-reread"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(input),
  })

  return parseJsonResponse<ExplainRereadResponse>(response, "Unable to explain section")
}

export async function checkDistraction(
  input: CheckDistractionRequest,
): Promise<CheckDistractionResponse> {
  const body = buildCheckDistractionBody(input)

  const response = await fetch(buildUrl("/assistance/check-distraction"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body),
  })

  return parseJsonResponse<CheckDistractionResponse>(
    response,
    "Unable to check distraction",
  )
}

export function getAssistancePromptActions(mode: AttentionMode): AssistancePromptAction[] {
  switch (mode) {
    case "scanning":
      return [
        {
          id: "summarise",
          label: "Summarise this section",
          description: "Get a fast summary of the current page range to reduce overload.",
        },
      ]
    case "rereading":
      return [
        {
          id: "explain-reread",
          label: "Explain this region",
          description: "Send the cropped region image for OCR + a clearer explanation.",
        },
      ]
    case "distraction":
      return [
        {
          id: "check-distraction",
          label: "Check distraction pattern",
          description: "Classify whether gaze jumps are genuine visual reference or drift.",
        },
      ]
    case "reading":
    default:
      return []
  }
}

export function setActiveDocumentId(id: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ACTIVE_DOC_KEY, id)
}

export function getActiveDocumentId(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(ACTIVE_DOC_KEY)
}

export function mapRegionPayload(images: RegionImagePayload[]): RegionImagePayload[] {
  return images.slice(0, 5)
}

function buildCheckDistractionBody(input: CheckDistractionRequest): CheckDistractionBackendBody {
  const fullPagePageNumber = normalizePageNumbers([input.fullPagePageNumber])[0]
  if (!fullPagePageNumber) {
    throw new Error("A valid fullPagePageNumber is required for distraction check")
  }

  const pageNumbers = normalizePageNumbers([fullPagePageNumber, ...input.pageNumbers])

  const regionImages = input.regionImages
    .map((region) => ({
      imageBase64: region.imageBase64.trim(),
      pageNumber: normalizePageNumbers([region.pageNumber])[0] ?? fullPagePageNumber,
    }))
    .filter((region) => region.imageBase64.length > 0)
    .slice(0, 4)

  if (regionImages.length < 2) {
    throw new Error("At least 2 region images are required for distraction check")
  }

  const recentCoordinates = input.recentCoordinates
    .filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y))
    .map((sample) => {
      const ts = Math.floor(sample.ts)
      const normalizedPageNumber = normalizePageNumbers([sample.pageNumber ?? 0])[0]
      return {
        x: sample.x,
        y: sample.y,
        ts,
        source: sample.source,
        pageNumber: normalizedPageNumber,
      }
    })
    .filter((sample) => sample.ts > 0)
    .slice(-2000)

  return {
    docId: input.docId,
    fullPageBase64: input.fullPageBase64,
    fullPagePageNumber,
    regionImages,
    pageNumbers: pageNumbers.length ? pageNumbers : [fullPagePageNumber],
    recentCoordinates: recentCoordinates.length > 0 ? recentCoordinates : undefined,
  }
}

function normalizePageNumbers(pageNumbers: number[]): number[] {
  const unique = new Set<number>()

  for (const page of pageNumbers) {
    if (!Number.isFinite(page)) continue
    const normalized = Math.floor(page)
    if (normalized > 0) {
      unique.add(normalized)
    }
  }

  return [...unique]
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(backendBaseUrl)) {
    return new URL(path, `${backendBaseUrl}/`).toString()
  }

  const base = backendBaseUrl.replace(/\/+$/g, "")
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/g, "")
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const rawBody = await response.text().catch(() => "")

  let payload: unknown = null
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(payload, fallbackMessage, rawBody)
    throw new Error(message)
  }

  if (payload === null) {
    if (!rawBody.trim()) {
      throw new Error(`${fallbackMessage}: empty response body`)
    }

    throw new Error(`${fallbackMessage}: invalid JSON response`)
  }

  return payload as T
}

function extractStringField(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  for (const keyPath of keys) {
    const value = keyPath.split(".").reduce<unknown>((current, key) => {
      if (typeof current !== "object" || current === null) {
        return undefined
      }

      return Reflect.get(current, key)
    }, payload)

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function extractErrorMessage(payload: unknown, fallbackMessage: string, rawBody?: string): string {
  if (!payload || typeof payload !== "object") return fallbackMessage

  const error = Reflect.get(payload, "error")
  if (typeof error === "string" && error.trim()) return error

  const message = Reflect.get(payload, "message")
  if (typeof message === "string" && message.trim()) return message

  const code = Reflect.get(payload, "code")
  if (typeof code === "string" && code.trim()) return code

  if (rawBody?.trim()) {
    return rawBody.slice(0, 200)
  }

  return fallbackMessage
}
