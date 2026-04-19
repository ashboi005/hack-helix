"use client"

import { Suspense, useEffect, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Space_Grotesk } from "next/font/google"

import { signIn, signUp, useSession } from "@/lib/auth-client"
import { getAuthErrorMessage } from "@/lib/auth-error"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

type AuthMode = "login" | "signup"

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, isPending, refetch } = useSession()

  const rawNext = searchParams.get("next")?.trim()
  const redirectTarget = rawNext && rawNext.startsWith("/") ? rawNext : "/pdf"

  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    if (session?.user?.id && !isPending) {
      router.replace(redirectTarget)
    }
  }, [session?.user?.id, isPending, router, redirectTarget])

  if (session?.user?.id && !isPending) {
    return (
      <main className={`${spaceGrotesk.className} relative min-h-screen overflow-hidden bg-[#040812] text-zinc-100`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />
        <section className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-8 sm:px-8 lg:px-10">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#070e1a]/90 p-6 text-sm text-zinc-300 shadow-[0_25px_40px_-28px_rgba(0,0,0,0.95)] sm:p-8">
            Redirecting to your PDF workspace...
          </div>
        </section>
      </main>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setSuccess("")

    try {
      const normalizedEmail = email.trim().toLowerCase()
      const normalizedPassword = password.trim()

      if (!normalizedEmail || !normalizedPassword) {
        throw new Error("Email and password are required.")
      }

      if (mode === "signup") {
        const normalizedName = name.trim()
        if (!normalizedName) {
          throw new Error("Name is required for signup.")
        }

        if (normalizedPassword.length < 8) {
          throw new Error("Password must be at least 8 characters.")
        }

        const result = await signUp.email({
          name: normalizedName,
          email: normalizedEmail,
          password: normalizedPassword,
        })

        if (result.error) {
          throw new Error(getAuthErrorMessage(result.error, "Unable to create your account."))
        }

        // After signup, the user is auto-signed in (autoSignIn: true in server config)
        await refetch()
        setSuccess("Account created! Redirecting...")
        setTimeout(() => {
          router.push(redirectTarget)
        }, 450)
        return
      }

      // Sign in
      const result = await signIn.email({
        email: normalizedEmail,
        password: normalizedPassword,
      })

      if (result.error) {
        throw new Error(getAuthErrorMessage(result.error, "Unable to sign in."))
      }

      await refetch()
      setSuccess(`Signed in as ${normalizedEmail}.`)
      setTimeout(() => {
        router.push(redirectTarget)
      }, 450)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to sign in.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={`${spaceGrotesk.className} relative min-h-screen overflow-hidden bg-[#040812] text-zinc-100`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.2),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-8 sm:px-8 lg:px-10">
        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#070e1a]/90 p-6 shadow-[0_25px_40px_-28px_rgba(0,0,0,0.95)] sm:p-8">
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                router.back()
                return
              }

              router.push("/")
            }}
            className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-100 transition-colors hover:bg-white/20"
          >
            ← Back
          </button>

          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">Account Access</p>
            <h1 className="text-3xl font-semibold tracking-tight">FocusLayer Authentication</h1>
            <p className="text-sm text-zinc-300 sm:text-base">Choose Login or Signup to continue.</p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode("login")
                setError("")
                setSuccess("")
              }}
              className={`h-10 rounded-lg text-sm font-semibold uppercase tracking-[0.1em] transition-colors ${mode === "login" ? "bg-amber-300 text-[#111827]" : "bg-transparent text-zinc-300 hover:bg-white/10"}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup")
                setError("")
                setSuccess("")
              }}
              className={`h-10 rounded-lg text-sm font-semibold uppercase tracking-[0.1em] transition-colors ${mode === "signup" ? "bg-amber-300 text-[#111827]" : "bg-transparent text-zinc-300 hover:bg-white/10"}`}
            >
              Signup
            </button>
          </div>

          <form className="mt-5 grid gap-3" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <label className="space-y-1 text-sm">
                <span className="font-medium">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your full name"
                  className="h-10 w-full rounded-md border border-white/20 bg-[#0b1324] px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                />
              </label>
            )}

            <label className="space-y-1 text-sm">
              <span className="font-medium">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="h-10 w-full rounded-md border border-white/20 bg-[#0b1324] px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                type="password"
                className="h-10 w-full rounded-md border border-white/20 bg-[#0b1324] px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              />
            </label>

            <button
              type="submit"
              disabled={busy || isPending}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-amber-300 px-4 text-sm font-semibold text-[#111827] transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (mode === "login" ? "Signing In..." : "Creating Account...") : (mode === "login" ? "Login" : "Signup")}
            </button>
          </form>

          {error && (
            <p className="mt-4 rounded-md border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {success && (
            <p className="mt-4 rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {success}
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
