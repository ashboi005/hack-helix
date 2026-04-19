"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type WheelEvent,
} from "react"
import { useRouter } from "next/navigation"
import { Space_Grotesk } from "next/font/google"

import { useSession } from "@/lib/auth-client"
import { useGazeActionNavigation } from "@/hooks/use-gaze-action-navigation"
import {
  checkDistraction,
  explainReread,
  getActiveDocumentId,
  getDocument,
  initiateDocumentUpload,
  listDocuments,
  mapRegionPayload,
  requestSummary,
  setActiveDocumentId,
  type DocumentSummary,
  uploadPdfToPresignedUrl,
} from "@/lib/attention/api"
import { detectAttentionMode } from "@/lib/attention/detector"
import { buildRegionScreenshots, canvasToBase64, cropRegionAtPointBase64 } from "@/lib/attention/screenshots"
import { appendCoordinateSample, getLastSeconds, readCoordinateWindow, writeCoordinateWindow } from "@/lib/attention/storage"
import type { AttentionMode, CoordinateSample, ScrollSample } from "@/lib/attention/types"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

type PdfDocumentLike = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageLike>
}

type PdfPageLike = {
  getViewport: (input: { scale: number }) => { width: number; height: number }
  render: (input: {
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
  }) => { promise: Promise<void> }
}

type PdfJsRuntime = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (input: { data: Uint8Array }) => { promise: Promise<PdfDocumentLike> }
}

type PdfWindow = Window & {
  pdfjsLib?: PdfJsRuntime
}

export default function PdfPage() {
  const router = useRouter()
  const { data: authSession, isPending: authPending } = useSession()
  const gazeNavigation = useGazeActionNavigation()

  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [activeDocId, setActiveDocIdState] = useState<string | null>(null)
  const [activeFileName, setActiveFileName] = useState("")
  const [status, setStatus] = useState("Ready")
  const [error, setError] = useState("")

  const [pdfLoaded, setPdfLoaded] = useState(false)
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [renderScale, setRenderScale] = useState(1.35)
  const [rendering, setRendering] = useState(false)

  const [mode, setMode] = useState<AttentionMode>("reading")
  const [modeReason, setModeReason] = useState("Waiting for movement signal")
  const [mockEyeTrackerEnabled, setMockEyeTrackerEnabled] = useState(false)

  const [summaryText, setSummaryText] = useState("")
  const [explanationText, setExplanationText] = useState("")
  const [distractionText, setDistractionText] = useState("")

  const [coordinates, setCoordinates] = useState<CoordinateSample[]>([])
  const [scrollSamples, setScrollSamples] = useState<ScrollSample[]>([])
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null)

  const [lastSummaryAt, setLastSummaryAt] = useState(0)
  const [lastExplainAt, setLastExplainAt] = useState(0)
  const [lastDistractionAt, setLastDistractionAt] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pdfDocRef = useRef<PdfDocumentLike | null>(null)
  const pdfJsRef = useRef<PdfJsRuntime | null>(null)
  const persistAtRef = useRef(0)
  const mockSampleAtRef = useRef(0)

  const isAuthenticated = Boolean(authSession?.user?.id)

  useEffect(() => {
    if (authPending) return
    if (!isAuthenticated) {
      router.replace("/login?next=/pdf")
      return
    }

    void refreshDocuments()
  }, [authPending, isAuthenticated, router])

  useEffect(() => {
    if (!isAuthenticated) return
    setCoordinates(readCoordinateWindow())
    setActiveDocIdState(getActiveDocumentId())
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !activeDocId) return

    const run = async () => {
      try {
        const doc = await getDocument(activeDocId)
        setActiveFileName(doc.fileName)
      } catch {
        setActiveDocIdState(null)
      }
    }

    void run()
  }, [activeDocId, isAuthenticated])

  useEffect(() => {
    if (!pdfLoaded || !pdfDocRef.current) return
    void renderPage(currentPage)
  }, [currentPage, renderScale, pdfLoaded])

  useEffect(() => {
    if (!isAuthenticated) return

    const timer = window.setInterval(() => {
      const recentCoordinates = getLastSeconds(coordinates, 20)
      const result = detectAttentionMode(recentCoordinates, scrollSamples)
      setMode(result.mode)
      setModeReason(
        `ltr ${result.metrics.leftToRightRatio.toFixed(2)} | rtl ${result.metrics.rightToLeftRatio.toFixed(2)} | erratic ${result.metrics.erraticRatio.toFixed(2)}`,
      )

      if (result.mode === "scanning" && result.metrics.scrollVelocity > 2.8) {
        void maybeSummarise()
      }

      if (result.mode === "rereading") {
        void maybeExplainReread()
      }

      if (result.mode === "distraction") {
        void maybeCheckDistraction()
      }
    }, 1600)

    return () => window.clearInterval(timer)
  }, [
    coordinates,
    currentPage,
    isAuthenticated,
    scrollSamples,
    lastSummaryAt,
    lastExplainAt,
    lastDistractionAt,
    activeDocId,
    lastPoint,
  ])

  useEffect(() => {
    const onEyeSample = (event: Event) => {
      if (mockEyeTrackerEnabled || !isAuthenticated) return

      const custom = event as CustomEvent<{ x: number; y: number; normalized?: boolean; pageNumber?: number }>
      if (!custom.detail) return

      const canvas = canvasRef.current
      if (!canvas) return

      const x = custom.detail.normalized ? custom.detail.x * canvas.width : custom.detail.x
      const y = custom.detail.normalized ? custom.detail.y * canvas.height : custom.detail.y

      pushCoordinate({
        x,
        y,
        source: "eye",
        pageNumber: custom.detail.pageNumber ?? currentPage,
      })
    }

    window.addEventListener("focuslayer-eye-sample", onEyeSample as EventListener)
    return () => window.removeEventListener("focuslayer-eye-sample", onEyeSample as EventListener)
  }, [currentPage, isAuthenticated, mockEyeTrackerEnabled])

  const currentLineIndex = useMemo(() => {
    const canvas = canvasRef.current
    if (!canvas || !lastPoint) return 0

    const lineHeight = 28
    const total = Math.max(8, Math.floor(canvas.height / lineHeight))
    const index = Math.floor((lastPoint.y / Math.max(1, canvas.height)) * total)
    return Math.max(0, Math.min(total - 1, index))
  }, [lastPoint])

  const lineRows = useMemo(() => {
    const canvas = canvasRef.current
    const lineHeight = 28
    const total = Math.max(8, Math.floor((canvas?.height ?? 920) / lineHeight))
    return Array.from({ length: total }, (_, index) => index)
  }, [pdfLoaded, currentPage])

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      setError("")

      if (!isAuthenticated) {
        setError("Login is required before uploading a PDF.")
        return
      }

      try {
        setStatus("Initiating upload...")
        const initiated = await initiateDocumentUpload({
          fileName: file.name,
          fileSizeBytes: file.size,
        })

        setStatus("Uploading PDF to presigned storage...")
        await uploadPdfToPresignedUrl(initiated.presignedUrl, file)

        setActiveDocumentId(initiated.documentId)
        setActiveDocIdState(initiated.documentId)
        setActiveFileName(file.name)

        await refreshDocuments()
        await loadPdf(file)

        setStatus("PDF ready. Attention tracking started.")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upload PDF")
      }
    },
    [isAuthenticated],
  )

  const onReaderMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const canvas = canvasRef.current
      if (!canvas || !isAuthenticated) return

      const now = Date.now()
      if (mockEyeTrackerEnabled && now - mockSampleAtRef.current < 16) return
      if (mockEyeTrackerEnabled) {
        mockSampleAtRef.current = now
      }

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width
      const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height

      pushCoordinate({ x, y, source: mockEyeTrackerEnabled ? "eye" : "cursor", pageNumber: currentPage })
    },
    [currentPage, isAuthenticated, mockEyeTrackerEnabled],
  )

  const onReaderWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!isAuthenticated) return

      const now = Date.now()
      setScrollSamples((previous) => {
        const next = [...previous, { deltaY: event.deltaY, ts: now }]
        return next.length > 220 ? next.slice(next.length - 220) : next
      })

      if (!pdfLoaded || rendering || totalPages <= 0) return
      if (Math.abs(event.deltaY) < 20) return

      setCurrentPage((previous) => {
        const direction = event.deltaY > 0 ? 1 : -1
        return clamp(previous + direction, 1, totalPages)
      })
    },
    [isAuthenticated, pdfLoaded, rendering, totalPages],
  )

  async function refreshDocuments() {
    if (!isAuthenticated) return

    try {
      const docs = await listDocuments()
      setDocuments(docs)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch documents")
    }
  }

  async function maybeSummarise() {
    if (!isAuthenticated || !activeDocId) return

    const now = Date.now()
    if (now - lastSummaryAt < 90_000) return

    try {
      setLastSummaryAt(now)
      const response =
        currentPage > 1
          ? await requestSummary({
              docId: activeDocId,
              scope: "partial",
              pageNumbers: [currentPage],
            })
          : await requestSummary({ docId: activeDocId, scope: "full" })

      setSummaryText(response.summary)
      setStatus("Summary suggestion generated")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to summarise")
    }
  }

  async function maybeExplainReread() {
    if (!isAuthenticated || !activeDocId || !lastPoint || !canvasRef.current) return

    const now = Date.now()
    if (now - lastExplainAt < 70_000) return

    try {
      setLastExplainAt(now)
      const regionBase64 = cropRegionAtPointBase64(canvasRef.current, lastPoint.x, lastPoint.y)
      const response = await explainReread({
        docId: activeDocId,
        pageNumber: currentPage,
        regionBase64,
      })

      setExplanationText(response.explanation)
      setStatus("Reread explanation generated")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to explain reread")
    }
  }

  async function maybeCheckDistraction() {
    if (!isAuthenticated || !activeDocId || !canvasRef.current) return

    const now = Date.now()
    if (now - lastDistractionAt < 75_000) return

    const last15 = getLastSeconds(coordinates, 15)
    if (last15.length < 20) return

    try {
      setLastDistractionAt(now)

      const fullPageBase64 = canvasToBase64(canvasRef.current)
      const regions = mapRegionPayload(buildRegionScreenshots(canvasRef.current, coordinates, currentPage, 5))
      if (regions.length < 2) return

      const response = await checkDistraction({
        docId: activeDocId,
        fullPageBase64,
        fullPagePageNumber: currentPage,
        regionImages: regions,
        pageNumbers: Array.from(new Set([currentPage, ...regions.map((region) => region.pageNumber)])),
        recentCoordinates: last15.slice(-2000).map((sample) => ({
          x: sample.x,
          y: sample.y,
          ts: sample.ts,
          source: sample.source,
          pageNumber: sample.pageNumber,
        })),
      })

      setDistractionText(`${response.genuine ? "Genuine pattern" : "Likely distraction"}: ${response.reason}`)
      setStatus("Distraction check completed")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed distraction check")
    }
  }

  function pushCoordinate(input: { x: number; y: number; source: "eye" | "cursor"; pageNumber: number }) {
    const sample: CoordinateSample = {
      x: Math.max(0, input.x),
      y: Math.max(0, input.y),
      source: input.source,
      ts: Date.now(),
      pageNumber: input.pageNumber,
    }

    setLastPoint({ x: sample.x, y: sample.y })

    setCoordinates((previous) => {
      const next = appendCoordinateSample(previous, sample)
      if (Date.now() - persistAtRef.current > 500) {
        writeCoordinateWindow(next)
        persistAtRef.current = Date.now()
      }
      return next
    })
  }

  async function loadPdf(file: File) {
    setError("")
    setStatus("Loading PDF document...")

    const pdfjs = await loadPdfJsRuntime()
    const data = await file.arrayBuffer()
    const documentTask = pdfjs.getDocument({ data: new Uint8Array(data) })
    const doc = await documentTask.promise

    pdfDocRef.current = doc
    setTotalPages(doc.numPages)
    setCurrentPage(1)
    setPdfLoaded(true)

    await renderPage(1, doc)
  }

  async function renderPage(pageNumber: number, docOverride?: PdfDocumentLike) {
    const doc = docOverride ?? pdfDocRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas) return

    setRendering(true)

    try {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: renderScale })
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        setError("Unable to initialize canvas context")
        return
      }

      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({ canvasContext: ctx, viewport }).promise
      setStatus(`Rendering page ${pageNumber} of ${doc.numPages}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to render PDF page")
    } finally {
      setRendering(false)
    }
  }

  async function loadPdfJsRuntime(): Promise<PdfJsRuntime> {
    if (pdfJsRef.current) return pdfJsRef.current

    const runtime = await loadPdfJsFromCdn()
    runtime.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
    pdfJsRef.current = runtime
    return runtime
  }

  if (authPending) {
    return (
      <main className={`${spaceGrotesk.className} min-h-screen bg-[#050914] px-6 py-10 text-zinc-100`}>
        <div className="mx-auto max-w-4xl rounded-xl border border-white/10 bg-[#0a1220]/90 p-6 text-sm text-zinc-300">
          Checking authentication for PDF workspace...
        </div>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className={`${spaceGrotesk.className} min-h-screen bg-[#050914] px-6 py-10 text-zinc-100`}>
        <div className="mx-auto max-w-4xl rounded-xl border border-white/10 bg-[#0a1220]/90 p-6 text-sm text-zinc-300">
          Redirecting to login...
        </div>
      </main>
    )
  }

  return (
    <main className={`${spaceGrotesk.className} min-h-screen bg-[#050914] text-zinc-100`}>
      {gazeNavigation.gazeControlEnabled && gazeNavigation.livePreviewActive && (
        <span
          className="pointer-events-none fixed z-50 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]"
          style={{ left: gazeNavigation.cursorPosition.x, top: gazeNavigation.cursorPosition.y }}
        />
      )}

      <section className="mx-auto flex min-h-screen w-full max-w-[1320px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-white/10 bg-[#0a1220]/90 p-5 shadow-[0_20px_45px_-35px_rgba(0,0,0,0.95)]">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">PDF Workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">ADHD Attention Reader</h1>
          <p className="mt-2 text-sm text-zinc-300">
            Upload PDF, track reading modes, keep a 60-second coordinate window, and trigger assistance routes from
            detected behavior.
          </p>
        </header>

        <div className="grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-[#08101e] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.13em] text-zinc-300">PDF Upload</h2>
              <div className="mt-3 space-y-3">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => void onFileChange(event)}
                  className="block w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border file:border-white/15 file:bg-[#11203a] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-zinc-100"
                />
                <p className="text-xs text-zinc-400">
                  Calls `POST /documents/initiate-upload`, uploads with presigned URL, then stores `documentId` locally.
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#08101e] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.13em] text-zinc-300">Documents</h2>
              <button
                onClick={() => void refreshDocuments()}
                className="h-9 w-full rounded-md border border-cyan-300/35 bg-cyan-500/15 text-xs font-semibold uppercase tracking-[0.1em] text-cyan-100 transition hover:bg-cyan-500/22"
              >
                Refresh Documents
              </button>
              <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
                {documents.map((document) => (
                  <button
                    key={document.id}
                    onClick={async () => {
                      try {
                        const exists = await getDocument(document.id)
                        setActiveDocumentId(exists.id)
                        setActiveDocIdState(exists.id)
                        setActiveFileName(exists.fileName)
                        setStatus(`Selected ${exists.fileName}. Re-upload local PDF file to render pages.`)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Unable to open document")
                      }
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                      activeDocId === document.id
                        ? "border-cyan-300/60 bg-cyan-500/18 text-cyan-100"
                        : "border-white/10 bg-[#0d1727] text-zinc-300 hover:border-white/20"
                    }`}
                  >
                    <div className="font-medium">{document.fileName}</div>
                    <div className="mt-1 font-mono text-[10px] text-zinc-400">{document.id.slice(0, 8)}...</div>
                  </button>
                ))}
                {!documents.length && <p className="text-xs text-zinc-500">No documents loaded yet.</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#08101e] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.13em] text-zinc-300">Mode</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <ModeChip mode={mode} value="reading" />
                <ModeChip mode={mode} value="rereading" />
                <ModeChip mode={mode} value="scanning" />
                <ModeChip mode={mode} value="distraction" />
              </div>

              <button
                onClick={() => setMockEyeTrackerEnabled((enabled) => !enabled)}
                className={`mt-3 h-9 w-full rounded-md border text-xs font-semibold uppercase tracking-[0.11em] transition ${
                  mockEyeTrackerEnabled
                    ? "border-cyan-300/55 bg-cyan-500/20 text-cyan-100"
                    : "border-white/15 bg-[#101a2a] text-zinc-300 hover:border-white/30"
                }`}
              >
                Mock Eye Tracker (Cursor): {mockEyeTrackerEnabled ? "On" : "Off"}
              </button>

              <p className="mt-2 text-[11px] text-zinc-400">{modeReason}</p>
            </section>
          </aside>

          <section className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-[#08101e] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Reader Surface</p>
                  <p className="text-xs text-zinc-400">
                    {activeFileName ? `${activeFileName} | doc ${activeDocId?.slice(0, 8) ?? "-"}` : "No PDF loaded"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((value) => clamp(value - 1, 1, totalPages || 1))}
                    className="h-8 rounded-md border border-white/15 bg-[#11203a] px-3 text-xs font-medium text-zinc-200"
                    disabled={!pdfLoaded}
                  >
                    Prev
                  </button>
                  <span className="text-xs text-zinc-300">
                    Page {currentPage} / {Math.max(totalPages, 1)}
                  </span>
                  <button
                    onClick={() => setCurrentPage((value) => clamp(value + 1, 1, totalPages || 1))}
                    className="h-8 rounded-md border border-white/15 bg-[#11203a] px-3 text-xs font-medium text-zinc-200"
                    disabled={!pdfLoaded}
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setRenderScale((value) => clamp(value - 0.1, 0.9, 2.3))}
                  className="h-8 rounded-md border border-white/15 bg-[#11203a] px-3 text-xs text-zinc-200"
                >
                  Zoom -
                </button>
                <button
                  onClick={() => setRenderScale((value) => clamp(value + 0.1, 0.9, 2.3))}
                  className="h-8 rounded-md border border-white/15 bg-[#11203a] px-3 text-xs text-zinc-200"
                >
                  Zoom +
                </button>
                <button
                  onClick={() => void maybeSummarise()}
                  className="h-8 rounded-md border border-emerald-300/35 bg-emerald-500/16 px-3 text-xs text-emerald-100"
                >
                  Trigger Summary
                </button>
                <button
                  onClick={() => void maybeExplainReread()}
                  className="h-8 rounded-md border border-cyan-300/35 bg-cyan-500/16 px-3 text-xs text-cyan-100"
                >
                  Trigger Reread Explain
                </button>
                <button
                  onClick={() => void maybeCheckDistraction()}
                  className="h-8 rounded-md border border-amber-300/35 bg-amber-500/16 px-3 text-xs text-amber-100"
                >
                  Trigger Distraction Check
                </button>
              </div>

              <div
                onMouseMove={onReaderMouseMove}
                onWheel={onReaderWheel}
                className="relative mt-4 overflow-auto rounded-xl border border-white/10 bg-[#03060e] p-3"
                style={{ minHeight: 640 }}
              >
                <div className="relative mx-auto w-fit">
                  <canvas ref={canvasRef} className="block max-w-full rounded-md bg-white" />

                  {pdfLoaded && (
                    <div className="pointer-events-none absolute inset-0 rounded-md">
                      {lineRows.map((row) => {
                        const topPercent = (row / lineRows.length) * 100
                        const heightPercent = 100 / lineRows.length
                        const shouldFade = row > currentLineIndex

                        return (
                          <div
                            key={row}
                            style={{
                              top: `${topPercent}%`,
                              height: `${heightPercent}%`,
                              background: shouldFade ? "rgba(120, 126, 140, 0.2)" : "transparent",
                            }}
                            className={`absolute inset-x-0 ${row === currentLineIndex ? "ring-1 ring-cyan-300/55" : ""}`}
                          />
                        )
                      })}
                    </div>
                  )}

                  {lastPoint && pdfLoaded && (
                    <span
                      className="pointer-events-none absolute -ml-1.5 -mt-1.5 h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_0_3px_rgba(34,211,238,0.35)]"
                      style={{
                        left: `${(lastPoint.x / Math.max(1, canvasRef.current?.width ?? 1)) * 100}%`,
                        top: `${(lastPoint.y / Math.max(1, canvasRef.current?.height ?? 1)) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>

              <p className="mt-2 text-xs text-zinc-400">
                Sliding coordinate window keeps only the latest 60 seconds. Last 15 seconds are sent with distraction
                checks along with full page screenshot and 5 region images.
              </p>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <ResponseCard title="Summary" content={summaryText} accent="emerald" />
              <ResponseCard title="Reread Explanation" content={explanationText} accent="cyan" />
              <ResponseCard title="Distraction Verdict" content={distractionText} accent="amber" />
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#08101e] p-4 text-xs">
              <p className="font-medium text-zinc-200">Status: {status}</p>
              {error && <p className="mt-1 text-rose-300">Error: {error}</p>}
              <p className="mt-2 text-zinc-400">
                Eye input source: {mockEyeTrackerEnabled ? "Mock (cursor as eye tracker)" : "Real eye stream or cursor fallback"}
              </p>
              <p className="mt-2 text-zinc-400">
                Samples in 60s window: {coordinates.length} | Current page: {currentPage} | Render scale: {renderScale.toFixed(2)}
              </p>
            </section>
          </section>
        </div>
      </section>

      {gazeNavigation.gazeControlEnabled && (
        <div className="pointer-events-none fixed left-4 top-4 z-40 rounded bg-black/70 px-3 py-2 text-sm text-white">
          <p>Live preview</p>
          <p className="text-xs text-white/70">Status: {gazeNavigation.livePreviewStatus}</p>
        </div>
      )}
    </main>
  )
}

function ModeChip({ mode, value }: { mode: AttentionMode; value: AttentionMode }) {
  const active = mode === value

  const tone =
    value === "reading"
      ? "border-emerald-300/35 bg-emerald-500/15 text-emerald-100"
      : value === "rereading"
        ? "border-cyan-300/35 bg-cyan-500/15 text-cyan-100"
        : value === "scanning"
          ? "border-indigo-300/35 bg-indigo-500/15 text-indigo-100"
          : "border-amber-300/35 bg-amber-500/15 text-amber-100"

  return (
    <span
      className={`rounded-md border px-2 py-1 text-center font-medium uppercase tracking-[0.08em] ${
        active ? tone : "border-white/15 bg-[#101a2a] text-zinc-400"
      }`}
    >
      {value}
    </span>
  )
}

function ResponseCard({ title, content, accent }: { title: string; content: string; accent: "emerald" | "cyan" | "amber" }) {
  const tone =
    accent === "emerald"
      ? "border-emerald-300/25 bg-emerald-500/10"
      : accent === "cyan"
        ? "border-cyan-300/25 bg-cyan-500/10"
        : "border-amber-300/25 bg-amber-500/10"

  return (
    <article className={`rounded-2xl border ${tone} p-4`}>
      <p className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-300">{title}</p>
      <p className="mt-2 max-h-56 overflow-auto text-sm leading-relaxed text-zinc-200">{content || "No response yet."}</p>
    </article>
  )
}

function clamp(value: number, min: number, max: number) {
  if (value < min) return min
  if (value > max) return max
  return value
}

async function loadPdfJsFromCdn(): Promise<PdfJsRuntime> {
  const win = window as PdfWindow
  if (win.pdfjsLib) return win.pdfjsLib

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-pdfjs="true"]')
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("Failed to load PDF runtime")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
    script.async = true
    script.defer = true
    script.dataset.pdfjs = "true"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load PDF runtime"))
    document.head.appendChild(script)
  })

  if (!win.pdfjsLib) {
    throw new Error("PDF runtime unavailable after script load")
  }

  return win.pdfjsLib
}
