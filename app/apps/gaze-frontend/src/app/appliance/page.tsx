"use client"

import Link from "next/link"
import { Space_Grotesk } from "next/font/google"

import { useGazeActionNavigation } from "@/hooks/use-gaze-action-navigation"
import { cn } from "@/lib/utils"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

export default function ApplianceControlPage() {
  const gazeNavigation = useGazeActionNavigation()

  return (
    <main className={cn(
      `${spaceGrotesk.className} relative min-h-screen bg-[#040812] text-zinc-100`,
      gazeNavigation.gazeControlEnabled && gazeNavigation.livePreviewActive && "cursor-none",
    )}>
      {gazeNavigation.gazeControlEnabled && gazeNavigation.livePreviewActive && (
        <span
          className="pointer-events-none fixed z-50 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]"
          style={{ left: gazeNavigation.cursorPosition.x, top: gazeNavigation.cursorPosition.y }}
        />
      )}

      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-10 sm:px-8 lg:px-10">
        <div className="mb-4 rounded-xl border border-white/10 bg-[#070e1a]/90 px-4 py-3 text-xs text-zinc-300">
          <p className="uppercase tracking-[0.12em] text-zinc-400">Live Navigation</p>
          <p className="mt-1 text-zinc-100">
            {gazeNavigation.gazeControlEnabled
              ? "Eye tracking active. Focus a button and press Space to open."
              : gazeNavigation.calibrationReady
                ? "Sign in to enable live gaze navigation on this page."
                : "Calibration and gyro setup are required for live gaze navigation."}
          </p>
          {gazeNavigation.livePreviewError && (
            <p className="mt-2 text-red-300">{gazeNavigation.livePreviewError}</p>
          )}
          {gazeNavigation.authError && (
            <p className="mt-2 text-red-300">{gazeNavigation.authError}</p>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-6 shadow-[0_25px_40px_-28px_rgba(0,0,0,0.95)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-200">Appliance Route</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Appliance Control Workspace</h1>
          <p className="mt-4 text-sm text-zinc-300 sm:text-base">
            Use this route for connected device controls, appliance state management, and action triggers.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/"
              data-gaze-action-id="appliance-dashboard"
              className={cn(
                "inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-100 transition-colors hover:bg-white/20",
                gazeNavigation.isActionFocused("appliance-dashboard") && "border-emerald-300/90 bg-emerald-500/20 text-emerald-100",
              )}
            >
              Back To PDF
            </Link>
            <Link
              href="/"
              data-gaze-action-id="appliance-home"
              className={cn(
                "inline-flex items-center rounded-full border border-white/20 bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200 transition-colors hover:bg-white/10",
                gazeNavigation.isActionFocused("appliance-home") && "border-emerald-300/90 bg-emerald-500/20 text-emerald-100",
              )}
            >
              Back To Home
            </Link>
            {!gazeNavigation.calibrationReady && (
              <Link
                href="/calibrate"
                data-gaze-action-id="appliance-setup"
                className={cn(
                  "inline-flex items-center rounded-full border border-amber-300/35 bg-amber-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-100 transition-colors hover:bg-amber-500/25",
                  gazeNavigation.isActionFocused("appliance-setup") && "border-emerald-300/90 bg-emerald-500/20 text-emerald-100",
                )}
              >
                Open Setup
              </Link>
            )}
          </div>
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
