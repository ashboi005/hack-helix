import type { ReactNode } from "react"

export function SectionCard(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">{props.title}</h2>
      </header>
      <div className="space-y-4 px-4 py-4">{props.children}</div>
    </section>
  )
}
