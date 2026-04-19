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
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Space_Grotesk } from "next/font/google"

import { useGazeLiveOverlay } from "@/components/gaze-live-overlay-provider"
import { useSession } from "@/lib/auth-client"
import {
  explainReread,
  getActiveDocumentId,
  getDocument,
  initiateDocumentUpload,
  listDocuments,
  requestSummary,
  setActiveDocumentId,
  type DocumentSummary,
  uploadPdfToPresignedUrl,
} from "@/lib/attention/api"
import { detectAttentionMode } from "@/lib/attention/detector"
import { canvasToBase64, cropLineAtPointBase64, renderGazeMarkedPageBase64 } from "@/lib/attention/screenshots"
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

type AssistPromptKind = "summarise-full" | "explain-reread"

type AssistPromptState = {
  kind: AssistPromptKind
  mode: AttentionMode
  title: string
  description: string
}

type EvidenceCapture = {
  createdAt: number
  pageNumber: number
  lookedPoint: { x: number; y: number }
  fullPageBase64: string
  markedPageBase64: string
  lineBase64: string
  actionLabel: string
}

export default function PdfPage() {
  const router = useRouter()
  const { data: authSession, isPending: authPending } = useSession()
  const { latestPoint: liveOverlayPoint, state: liveOverlayState } = useGazeLiveOverlay()

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
  const [assistPrompt, setAssistPrompt] = useState<AssistPromptState | null>(null)
  const [assistBusy, setAssistBusy] = useState(false)
  const [evidenceCapture, setEvidenceCapture] = useState<EvidenceCapture | null>(null)

  const [coordinates, setCoordinates] = useState<CoordinateSample[]>([])
  const [scrollSamples, setScrollSamples] = useState<ScrollSample[]>([])
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pdfDocRef = useRef<PdfDocumentLike | null>(null)
  const pdfJsRef = useRef<PdfJsRuntime | null>(null)
  const persistAtRef = useRef(0)
  const mockSampleAtRef = useRef(0)
  const lastLiveOverlaySampleTsRef = useRef(0)
  const lastPromptedModeRef = useRef<AttentionMode>("reading")
  const promptCooldownRef = useRef<Record<AssistPromptKind, number>>({
    "summarise-full": 0,
    "explain-reread": 0,
  })
  const detectionTickRef = useRef<() => void>(() => {})

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

  // Keep the detection callback fresh on every render so the timer
  // always reads the latest state without needing coordinates/scrollSamples
  // in the timer effect's dependency array (which caused the stale-closure bug
  // where the interval was torn down and recreated on every mouse-move).
  useEffect(() => {
    detectionTickRef.current = () => {
      const recentCoordinates = getLastSeconds(coordinates, 10)
      const result = detectAttentionMode(recentCoordinates, scrollSamples)
      setMode(result.mode)
      setModeReason(
        `fwd ${result.metrics.leftToRightRatio.toFixed(2)} | reread ${result.metrics.rightToLeftRatio.toFixed(2)} | jumps ${result.metrics.erraticRatio.toFixed(2)}`,
      )
    }
  })

  // Stable timer — only depends on isAuthenticated, never torn down by
  // coordinate changes.  Calls through the ref so it always runs the
  // latest closure.
  useEffect(() => {
    if (!isAuthenticated) return

    const timer = window.setInterval(() => detectionTickRef.current(), 400)
    return () => window.clearInterval(timer)
  }, [isAuthenticated])

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

  useEffect(() => {
    if (mockEyeTrackerEnabled || !isAuthenticated) return
    if (!liveOverlayState.livePreviewActive || !liveOverlayPoint) return
    if (liveOverlayPoint.timestamp <= lastLiveOverlaySampleTsRef.current) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const offsetX = liveOverlayPoint.x - rect.left
    const offsetY = liveOverlayPoint.y - rect.top
    const insideCanvas = offsetX >= 0 && offsetY >= 0 && offsetX <= rect.width && offsetY <= rect.height
    if (!insideCanvas) return

    lastLiveOverlaySampleTsRef.current = liveOverlayPoint.timestamp

    const x = (offsetX / rect.width) * canvas.width
    const y = (offsetY / rect.height) * canvas.height

    pushCoordinate({
      x,
      y,
      source: "eye",
      pageNumber: currentPage,
    })
  }, [
    currentPage,
    isAuthenticated,
    liveOverlayPoint,
    liveOverlayState.livePreviewActive,
    mockEyeTrackerEnabled,
  ])

  useEffect(() => {
    const previousMode = lastPromptedModeRef.current
    if (mode === previousMode) return
    lastPromptedModeRef.current = mode

    if (!isAuthenticated || !activeDocId || !pdfLoaded || !lastPoint) return
    if (assistPrompt || assistBusy) return
    if (mode !== "distraction" && mode !== "rereading") return

    const kind: AssistPromptKind = mode === "distraction" ? "summarise-full" : "explain-reread"
    const now = Date.now()
    if (now - promptCooldownRef.current[kind] < 25_000) return

    setAssistPrompt(
      mode === "distraction"
        ? {
            kind,
            mode,
            title: "You look distracted",
            description: "Generate a quick AI summary for the whole PDF? Press Space to confirm.",
          }
        : {
            kind,
            mode,
            title: "Rereading detected",
            description: "Explain the specific line you are repeatedly reading? Press Space to confirm.",
          },
    )
  }, [activeDocId, assistBusy, assistPrompt, isAuthenticated, lastPoint, mode, pdfLoaded])

  // Cursor Y as a percentage of the canvas height (0-100), used for the spotlight overlay
  const cursorYPercent = useMemo(() => {
    const canvas = canvasRef.current
    if (!canvas || !lastPoint) return 50
    return Math.max(0, Math.min(100, (lastPoint.y / Math.max(1, canvas.height)) * 100))
  }, [lastPoint])

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

  const buildEvidenceCapture = useCallback(
    (actionLabel: string): EvidenceCapture | null => {
      const canvas = canvasRef.current
      if (!canvas || !lastPoint) return null

      const lookedPoint = {
        x: clamp(lastPoint.x, 0, canvas.width),
        y: clamp(lastPoint.y, 0, canvas.height),
      }

      return {
        createdAt: Date.now(),
        pageNumber: currentPage,
        lookedPoint,
        fullPageBase64: canvasToBase64(canvas),
        markedPageBase64: renderGazeMarkedPageBase64(canvas, lookedPoint.x, lookedPoint.y),
        lineBase64: cropLineAtPointBase64(canvas, lookedPoint.x, lookedPoint.y),
        actionLabel,
      }
    },
    [currentPage, lastPoint],
  )

  const runAssistPrompt = useCallback(
    async (kind: AssistPromptKind) => {
      if (!isAuthenticated || !activeDocId) return
      if (assistBusy) return

      const evidence = buildEvidenceCapture(
        kind === "summarise-full" ? "Distraction full-document summary" : "Reread line explanation",
      )
      if (!evidence) {
        setStatus("Need an active page and gaze point before generating assistance")
        return
      }

      promptCooldownRef.current[kind] = Date.now()
      setAssistBusy(true)
      setAssistPrompt(null)
      setEvidenceCapture(evidence)
      setError("")

      try {
        if (kind === "summarise-full") {
          setStatus("Generating full PDF summary from distraction prompt...")
          const response = await requestSummary({
            docId: activeDocId,
            scope: "full",
          })
          setSummaryText(response.summary)
          setDistractionText("Distraction prompt accepted. Generated a summary for the whole PDF.")
          setStatus("Full PDF summary generated")
          return
        }

        setStatus("Generating reread explanation for focused line...")
        const response = await explainReread({
          docId: activeDocId,
          pageNumber: evidence.pageNumber,
          regionBase64: evidence.lineBase64,
        })
        setExplanationText(response.explanation)
        setDistractionText("Reread prompt accepted. Generated an explanation for the current line.")
        setStatus("Line explanation generated")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate assistance")
      } finally {
        setAssistBusy(false)
      }
    },
    [activeDocId, assistBusy, buildEvidenceCapture, isAuthenticated],
  )

  useEffect(() => {
    if (!assistPrompt) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      if (assistBusy) return
      void runAssistPrompt(assistPrompt.kind)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [assistBusy, assistPrompt, runAssistPrompt])

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
      <main className={`${spaceGrotesk.className} relative min-h-screen overflow-hidden bg-[#040812] text-zinc-100`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />
        <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
          <div className="rounded-xl border border-white/10 bg-[#070e1a]/90 p-6 text-sm text-zinc-300 shadow-[0_18px_32px_-28px_rgba(0,0,0,0.95)]">
            Checking authentication for PDF workspace...
          </div>
        </section>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className={`${spaceGrotesk.className} relative min-h-screen overflow-hidden bg-[#040812] text-zinc-100`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />
        <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
          <div className="rounded-xl border border-white/10 bg-[#070e1a]/90 p-6 text-sm text-zinc-300 shadow-[0_18px_32px_-28px_rgba(0,0,0,0.95)]">
            Redirecting to login...
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className={`${spaceGrotesk.className} relative min-h-screen overflow-hidden bg-[#040812] text-zinc-100`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-6 py-8 sm:px-8 lg:px-10">
        <header className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-5 shadow-[0_20px_45px_-35px_rgba(0,0,0,0.95)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">PDF Workspace</p>
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-100 transition-colors hover:bg-white/20"
            >
              Back To Home
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">ADHD Attention Reader</h1>
          <p className="mt-2 text-sm text-zinc-300">
            Upload PDF, track reading modes, keep a 60-second coordinate window, and trigger assistance routes from
            detected behavior.
          </p>
        </header>

        <div className="grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-4">
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

            <section className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-4">
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
                        : "border-white/10 bg-[#0d1628] text-zinc-300 hover:border-white/20"
                    }`}
                  >
                    <div className="font-medium">{document.fileName}</div>
                    <div className="mt-1 font-mono text-[10px] text-zinc-400">{document.id.slice(0, 8)}...</div>
                  </button>
                ))}
                {!documents.length && <p className="text-xs text-zinc-500">No documents loaded yet.</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-4">
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
            <section className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-4">
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
              </div>

              <div
                onMouseMove={onReaderMouseMove}
                onWheel={onReaderWheel}
                className="relative mt-4 overflow-auto rounded-xl border border-white/10 bg-[#03060e] p-3"
                style={{ minHeight: 640 }}
              >
                <div className="relative mx-auto w-fit">
                  <canvas ref={canvasRef} className="block max-w-full rounded-md bg-white" />

                  {pdfLoaded && lastPoint && (() => {
                    // Spotlight band: 3% of canvas height centered on cursor
                    const bandHalf = 1.5
                    const aboveEnd = Math.max(0, cursorYPercent - bandHalf)
                    const belowStart = Math.min(100, cursorYPercent + bandHalf)

                    return (
                      <div className="pointer-events-none absolute inset-0 rounded-md">
                        {/* Already-read zone (above cursor) */}
                        {aboveEnd > 0 && (
                          <div
                            className="absolute inset-x-0 top-0"
                            style={{
                              height: `${aboveEnd}%`,
                              background: "rgba(0, 0, 0, 0.45)",
                              transition: "height 0.12s linear",
                            }}
                          />
                        )}
                        {/* Current reading band — transparent with highlight border */}
                        <div
                          className="absolute inset-x-0 ring-1 ring-cyan-300/55"
                          style={{
                            top: `${aboveEnd}%`,
                            height: `${belowStart - aboveEnd}%`,
                            transition: "top 0.12s linear, height 0.12s linear",
                          }}
                        />
                        {/* Not-yet-read zone (below cursor) */}
                        {belowStart < 100 && (
                          <div
                            className="absolute inset-x-0 bottom-0"
                            style={{
                              height: `${100 - belowStart}%`,
                              background: "rgba(0, 0, 0, 0.25)",
                              transition: "height 0.12s linear",
                            }}
                          />
                        )}
                      </div>
                    )
                  })()}

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
                Sliding coordinate window keeps only the latest 60 seconds. Assistance prompts use line-focused
                screenshots from the current gaze point.
              </p>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <ResponseCard title="Summary" content={summaryText} accent="emerald" />
              <ResponseCard title="Reread Explanation" content={explanationText} accent="cyan" />
              <ResponseCard title="Distraction Verdict" content={distractionText} accent="amber" />
            </section>

            {evidenceCapture && (
              <section className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Gaze Evidence</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {evidenceCapture.actionLabel} | page {evidenceCapture.pageNumber} | ({Math.round(evidenceCapture.lookedPoint.x)},{" "}
                  {Math.round(evidenceCapture.lookedPoint.y)})
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <EvidenceImage title="Whole Page" base64={evidenceCapture.fullPageBase64} />
                  <EvidenceImage title="Looked Region" base64={evidenceCapture.markedPageBase64} />
                  <EvidenceImage title="Specific Line" base64={evidenceCapture.lineBase64} />
                </div>
              </section>
            )}

            {assistPrompt && (
              <AssistPromptToast
                prompt={assistPrompt}
                busy={assistBusy}
                onConfirm={() => void runAssistPrompt(assistPrompt.kind)}
                onDismiss={() => setAssistPrompt(null)}
              />
            )}

            <section className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-4 text-xs">
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

function EvidenceImage({ title, base64 }: { title: string; base64: string }) {
  return (
    <article className="rounded-lg border border-white/10 bg-[#0d1727] p-2">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.09em] text-zinc-400">{title}</p>
      <img src={`data:image/png;base64,${base64}`} alt={title} className="w-full rounded-md border border-white/10 bg-black/30" />
    </article>
  )
}

function AssistPromptToast({
  prompt,
  busy,
  onConfirm,
  onDismiss,
}: {
  prompt: AssistPromptState
  busy: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  const tone = prompt.mode === "distraction" ? "border-amber-300/45 bg-[#1c1310]" : "border-cyan-300/45 bg-[#0f1722]"

  return (
    <div className="fixed inset-x-0 bottom-5 z-50 px-4">
      <div className={`mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-xl border p-4 shadow-2xl ${tone}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">{prompt.title}</p>
        <p className="text-sm text-zinc-100">{prompt.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-8 rounded-md border border-cyan-300/45 bg-cyan-500/20 px-3 font-semibold uppercase tracking-[0.08em] text-cyan-100 disabled:opacity-60"
          >
            {busy ? "Generating..." : "Confirm (Space)"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="h-8 rounded-md border border-white/20 bg-white/5 px-3 font-semibold uppercase tracking-[0.08em] text-zinc-200 disabled:opacity-60"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
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
