import Link from "next/link"
import { Space_Grotesk } from "next/font/google"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

type ProjectHomeHubMode = "home" | "dashboard"

const launchOptions = [
  {
    title: "LMS",
    subtitle: "YouTube Learning",
    description: "Open the LMS experience powered by your YouTube route.",
    href: "/youtube",
    actionLabel: "Open LMS",
    accent: "from-rose-400/35 to-orange-500/20",
  },
  {
    title: "PDF Viewer",
    subtitle: "Document Workspace",
    description: "Read and interact with study PDFs in the focused viewer route.",
    href: "/pdf",
    actionLabel: "Open PDF Viewer",
    accent: "from-blue-400/35 to-cyan-500/20",
  },
  {
    title: "Setup",
    subtitle: "Calibration",
    description: "Run gaze setup, calibration, and live preview controls.",
    href: "/calibrate",
    actionLabel: "Open Setup",
    accent: "from-emerald-400/35 to-teal-500/20",
  },
  {
    title: "Appliance Control",
    subtitle: "Device Actions",
    description: "Jump into appliance-level controls and status operations.",
    href: "/appliance",
    actionLabel: "Open Appliance",
    accent: "from-violet-400/35 to-indigo-500/20",
  },
  {
    title: "Login",
    subtitle: "Account Access",
    description: "Authenticate before setup and route into your personalized session.",
    href: "/login",
    actionLabel: "Open Login",
    accent: "from-amber-300/35 to-yellow-500/20",
  },
] as const

const modeCopy: Record<
  ProjectHomeHubMode,
  {
    eyebrow: string
    title: string
    description: string
    alternateHref: string
    alternateLabel: string
  }
> = {
  home: {
    eyebrow: "HackHelix",
    title: "Gaze Frontend Launcher",
    description: "Home and dashboard now share the same card-based route surface. Choose any card to move into that module.",
    alternateHref: "/dashboard",
    alternateLabel: "Open Dashboard",
  },
  dashboard: {
    eyebrow: "Project Dashboard",
    title: "Gaze Frontend Control Surface",
    description: "This dashboard intentionally mirrors home so the route flow stays consistent everywhere.",
    alternateHref: "/",
    alternateLabel: "Open Home",
  },
}

export function ProjectHomeHub() {


  return (
    <main className={`${spaceGrotesk.className} relative min-h-screen overflow-hidden bg-[#040812] text-zinc-100`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
        <div className="grid flex-1 auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
          {launchOptions.map((option) => (
            <Link
              key={option.title}
              href={option.href}
              className="group relative flex min-h-[200px] overflow-hidden rounded-2xl border border-white/10 bg-[#070e1a]/90 p-6 shadow-[0_25px_40px_-28px_rgba(0,0,0,0.95)] transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-[#0d1628] md:p-8"
            >
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${option.accent} opacity-80 transition-opacity duration-300 group-hover:opacity-100`} />
              <div className="relative flex h-full w-full flex-col justify-between gap-6">
                <div className="space-y-4">
                  <div className="inline-flex rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200">
                    {option.subtitle}
                  </div>
                  <h2 className="text-3xl font-semibold tracking-tight text-zinc-100">{option.title}</h2>
                  <p className="text-sm leading-relaxed text-zinc-300 sm:text-base">{option.description}</p>
                </div>
                <span className="inline-flex w-fit items-center rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-100">
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