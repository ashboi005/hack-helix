import type { NextRequest } from "next/server"

const LOCAL_BACKEND_FALLBACK = "http://localhost:3000"
const UPSTREAM_TIMEOUT_MS = 120000

function getBackendBaseUrl(): string {
  const configured = process.env.APP_BACKEND_URL ?? process.env.NEXT_PUBLIC_APP_BACKEND_URL
  const value = configured?.trim()

  if (!value) {
    return LOCAL_BACKEND_FALLBACK
  }

  return value.endsWith("/") ? value.slice(0, -1) : value
}

function buildUpstreamUrl(request: NextRequest, pathSegments: string[]): string {
  const backendBaseUrl = getBackendBaseUrl()
  const pathname = pathSegments.length > 0 ? pathSegments.join("/") : ""
  const search = request.nextUrl.search || ""

  return `${backendBaseUrl}/${pathname}${search}`
}

function cloneForwardHeaders(source: Headers): Headers {
  const headers = new Headers(source)
  // These may become stale after body transformations.
  headers.delete("content-length")
  headers.delete("transfer-encoding")
  headers.delete("content-encoding")
  return headers
}

async function proxyBackendRequest(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const url = buildUpstreamUrl(request, pathSegments)
  const headers = new Headers(request.headers)

  headers.delete("host")
  headers.delete("content-length")

  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  const body = hasBody ? await request.arrayBuffer() : undefined

  const makeRequest = () =>
    fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

  let upstreamResponse: Response

  try {
    upstreamResponse = await makeRequest()

    if ([502, 503, 504].includes(upstreamResponse.status)) {
      upstreamResponse = await makeRequest()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream connection error"

    return Response.json(
      {
        error: "backend_unreachable",
        code: "BACKEND_UNREACHABLE",
        details: {
          backendUrl: url,
          timeoutMs: UPSTREAM_TIMEOUT_MS,
          message,
        },
      },
      { status: 502 },
    )
  }

  const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? ""

  if (upstreamResponse.status === 502 && contentType.includes("text/html")) {
    const html = await upstreamResponse.text()
    const compactHtml = html.slice(0, 500)

    return Response.json(
      {
        error: "upstream_bad_gateway",
        code: "UPSTREAM_BAD_GATEWAY",
        details: {
          backendUrl: url,
          hint: "Verify APP_BACKEND_URL points to your backend service (prefer internal service URL in Coolify).",
          upstreamContentType: contentType,
          upstreamSnippet: compactHtml,
        },
      },
      { status: 502 },
    )
  }

  if (contentType.includes("application/json")) {
    const rawJson = await upstreamResponse.text()

    if (!rawJson.trim()) {
      return Response.json(
        {
          error: "upstream_empty_json",
          code: "UPSTREAM_EMPTY_JSON",
          details: {
            backendUrl: url,
            status: upstreamResponse.status,
          },
        },
        { status: 502 },
      )
    }

    try {
      JSON.parse(rawJson)
    } catch {
      return Response.json(
        {
          error: "upstream_invalid_json",
          code: "UPSTREAM_INVALID_JSON",
          details: {
            backendUrl: url,
            status: upstreamResponse.status,
            upstreamSnippet: rawJson.slice(0, 500),
          },
        },
        { status: 502 },
      )
    }

    const headersForClient = cloneForwardHeaders(upstreamResponse.headers)
    headersForClient.set("content-type", "application/json; charset=utf-8")

    return new Response(rawJson, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: headersForClient,
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: cloneForwardHeaders(upstreamResponse.headers),
  })
}

type BackendRouteContext = {
  params: Promise<{
    all: string[]
  }>
}

export async function GET(request: NextRequest, context: BackendRouteContext): Promise<Response> {
  const { all } = await context.params
  return proxyBackendRequest(request, all)
}

export async function POST(request: NextRequest, context: BackendRouteContext): Promise<Response> {
  const { all } = await context.params
  return proxyBackendRequest(request, all)
}

export async function PUT(request: NextRequest, context: BackendRouteContext): Promise<Response> {
  const { all } = await context.params
  return proxyBackendRequest(request, all)
}

export async function PATCH(request: NextRequest, context: BackendRouteContext): Promise<Response> {
  const { all } = await context.params
  return proxyBackendRequest(request, all)
}

export async function DELETE(request: NextRequest, context: BackendRouteContext): Promise<Response> {
  const { all } = await context.params
  return proxyBackendRequest(request, all)
}

export async function OPTIONS(request: NextRequest, context: BackendRouteContext): Promise<Response> {
  const { all } = await context.params
  return proxyBackendRequest(request, all)
}
