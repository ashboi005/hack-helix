import Link from "next/link"
import { Space_Grotesk } from "next/font/google"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

const launchOptions = [
  {
    title: "Calibration Workspace",
    description: "Run camera setup, 9-point calibration, and live preview from one flow.",
    href: "/calibrate",
    actionLabel: "Open Calibration",
    accent: "from-cyan-400/35 to-sky-500/15",
  },
  {
    title: "Project Dashboard",
    description: "View the project control surface and move into the next app stage.",
    href: "/dashboard",
    actionLabel: "Open Dashboard",
    accent: "from-emerald-400/35 to-teal-500/15",
  },
] as const

export function ProjectHomeHub() {
  return (
    <main className={`${spaceGrotesk.className} relative h-screen overflow-hidden bg-[#040812] text-zinc-100`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />

      <section className="relative mx-auto flex h-full w-full max-w-6xl flex-col justify-center px-6 py-8 sm:px-8 lg:px-10">
        <header className="mb-8 space-y-2 sm:mb-10">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-400">HackHelix</p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
            Gaze Frontend Launcher
          </h1>
          <p className="max-w-2xl text-pretty text-sm text-zinc-400 sm:text-base">
            Choose how you want to enter the project. Both options below map directly to routes already available in this app.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {launchOptions.map((option) => (
            <Link
              key={option.title}
              href={option.href}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#070e1a]/90 p-6 shadow-[0_25px_40px_-28px_rgba(0,0,0,0.95)] transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-[#0d1628]"
            >
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${option.accent} opacity-80 transition-opacity duration-300 group-hover:opacity-100`} />
              <div className="relative space-y-4">
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">{option.title}</h2>
                <p className="text-sm leading-relaxed text-zinc-300">{option.description}</p>
                <span className="inline-flex items-center rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-100">
                  {option.actionLabel}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}