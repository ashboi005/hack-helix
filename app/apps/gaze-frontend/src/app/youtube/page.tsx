import Link from "next/link"
import { Space_Grotesk } from "next/font/google"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

export default function YoutubeLmsPage() {
  return (
    <main className={`${spaceGrotesk.className} min-h-screen bg-[#040812] text-zinc-100`}>
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-10 sm:px-8 lg:px-10">
        <div className="rounded-2xl border border-white/10 bg-[#070e1a]/90 p-6 shadow-[0_25px_40px_-28px_rgba(0,0,0,0.95)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-200">LMS Route</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">YouTube Learning Workspace</h1>
          <p className="mt-4 text-sm text-zinc-300 sm:text-base">
            This is the LMS destination route for the card flow. Connect your YouTube learning tools here.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-100 transition-colors hover:bg-white/20"
            >
              Back To Dashboard
            </Link>
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-white/20 bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200 transition-colors hover:bg-white/10"
            >
              Back To Home
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}