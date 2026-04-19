import type { NextRequest } from "next/server"

const LOCAL_BACKEND_FALLBACK = "http://localhost:3000"

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

async function proxyBackendRequest(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const url = buildUpstreamUrl(request, pathSegments)
  const headers = new Headers(request.headers)

  headers.delete("host")
  headers.delete("content-length")

  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  const body = hasBody ? await request.arrayBuffer() : undefined

  let upstreamResponse: Response

  try {
    upstreamResponse = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream connection error"

    return Response.json(
      {
        error: "backend_unreachable",
        code: "BACKEND_UNREACHABLE",
        details: {
          backendUrl: url,
          message,
        },
      },
      { status: 502 },
    )
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: upstreamResponse.headers,
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
