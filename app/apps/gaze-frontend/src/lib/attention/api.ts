import { getGazeCoreDemoConfig } from "@/lib/gaze/gaze-core-demo-config"

import type { CheckDistractionRequest, RegionImagePayload } from "./types"

const ACTIVE_DOC_KEY = "focuslayer-active-document-id"

type InitiateUploadBody = {
  fileName: string
  fileSizeBytes: number
}

type InitiateUploadResponse = {
  presignedUrl: string
  documentId: string
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
  input: { docId: string; scope: "full" } | { docId: string; scope: "partial"; pageNumbers: number[] },
): Promise<{ summary: string }> {
  const response = await fetch(buildUrl("/assistance/summarise"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(input),
  })

  return parseJsonResponse<{ summary: string }>(response, "Unable to fetch summary")
}

export async function explainReread(input: { docId: string; pageNumber: number; regionBase64: string }): Promise<{ explanation: string }> {
  const response = await fetch(buildUrl("/assistance/explain-reread"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(input),
  })

  return parseJsonResponse<{ explanation: string }>(response, "Unable to explain section")
}

export async function checkDistraction(
  input: CheckDistractionRequest,
): Promise<{ genuine: boolean; reason: string; pageNumbers: number[] }> {
  const response = await fetch(buildUrl("/assistance/check-distraction"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(input),
  })

  return parseJsonResponse<{ genuine: boolean; reason: string; pageNumbers: number[] }>(
    response,
    "Unable to check distraction",
  )
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

function buildUrl(path: string): string {
  return new URL(path, `${backendBaseUrl}/`).toString()
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/g, "")
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message = extractErrorMessage(payload, fallbackMessage)
    throw new Error(message)
  }

  return payload as T
}

function extractErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (!payload || typeof payload !== "object") return fallbackMessage

  const error = Reflect.get(payload, "error")
  if (typeof error === "string" && error.trim()) return error

  const message = Reflect.get(payload, "message")
  if (typeof message === "string" && message.trim()) return message

  const code = Reflect.get(payload, "code")
  if (typeof code === "string" && code.trim()) return code

  return fallbackMessage
}
