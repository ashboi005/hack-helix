import Link from "next/link"
import { Space_Grotesk } from "next/font/google"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

export default function DashboardPage() {
  return (
    <main className={`${spaceGrotesk.className} min-h-screen bg-[#050914] text-zinc-100`}>
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-8 lg:px-10">
        <header className="mb-8 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">Project Dashboard</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Gaze Frontend Control</h1>
          <p className="text-sm text-zinc-400 sm:text-base">
            This dashboard is now project-specific. Continue with calibration or jump back to the launcher.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/calibrate"
            className="rounded-2xl border border-cyan-300/25 bg-cyan-500/10 p-6 transition-colors hover:bg-cyan-500/15"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Action</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">Open Calibration</h2>
            <p className="mt-2 text-sm text-zinc-300">Run setup, 9-point capture, and live preview controls.</p>
          </Link>

          <Link
            href="/"
            className="rounded-2xl border border-emerald-300/25 bg-emerald-500/10 p-6 transition-colors hover:bg-emerald-500/15"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">Navigation</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">Back To Home</h2>
            <p className="mt-2 text-sm text-zinc-300">Return to the launcher and choose a route again.</p>
          </Link>
        </div>
      </section>
    </main>
  )
}
