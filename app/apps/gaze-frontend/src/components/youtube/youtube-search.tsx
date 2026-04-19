"use client"

import { useState } from "react"
import Link from "next/link"
import { Space_Grotesk } from "next/font/google"
import { Search } from "lucide-react"

import { useGazeActionNavigation } from "@/hooks/use-gaze-action-navigation"
import { useYouTubeApi, type YouTubeVideo } from "@/hooks/use-youtube-api"
import { cn } from "@/lib/utils"

const spaceGrotesk = Space_Grotesk({
    subsets: ["latin"],
    weight: ["500", "600", "700"],
})

interface YouTubeSearchProps {
    onSelectVideo: (video: YouTubeVideo) => void
}

export function YouTubeSearch({ onSelectVideo }: YouTubeSearchProps) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<YouTubeVideo[]>([])
    const [hasSearched, setHasSearched] = useState(false)
    const { searchVideos, isSearching } = useYouTubeApi()
    const gazeNavigation = useGazeActionNavigation()

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        if (!query.trim()) return

        setHasSearched(true)
        const videos = await searchVideos(query)
        setResults(videos)
    }

    return (
        <div
            className={cn(
                `relative mx-auto flex w-full max-w-6xl flex-col px-6 py-6 sm:px-8 ${spaceGrotesk.className}`,
                gazeNavigation.gazeControlEnabled && gazeNavigation.livePreviewActive && "cursor-none",
            )}
        >
            {gazeNavigation.gazeControlEnabled && gazeNavigation.livePreviewActive && (
                <span
                    className="pointer-events-none fixed z-50 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]"
                    style={{ left: gazeNavigation.cursorPosition.x, top: gazeNavigation.cursorPosition.y }}
                />
            )}

            <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-white">YouTube LMS</h1>
                    <p className="text-sm text-zinc-400">Search and learn via YouTube</p>
                </div>
                <div className="flex gap-2">
                    <Link
                        href="/"
                        data-gaze-action-id="youtube-dashboard"
                        className={cn(
                            "inline-flex items-center rounded-full border border-white/20 bg-white/5 py-1.5 px-4 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-300 transition-colors hover:bg-white/10",
                            gazeNavigation.isActionFocused("youtube-dashboard") && "border-emerald-300/90 bg-emerald-500/20 text-emerald-100",
                        )}
                    >
                        ← Dashboard
                    </Link>
                </div>
            </div>

            <form onSubmit={handleSearch} className="relative mb-10 w-full max-w-2xl mx-auto flex">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for lectures, tutorials..."
                    className="h-14 w-full rounded-l-full border border-white/20 bg-[#070e1a]/80 pl-6 pr-12 text-sm text-white outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all placeholder:text-zinc-500"
                />
                <button
                    type="submit"
                    disabled={isSearching || !query.trim()}
                    data-gaze-action-id="youtube-search-submit"
                    className={cn(
                        "flex h-14 w-16 items-center justify-center rounded-r-full border border-l-0 border-white/20 bg-white/5 text-zinc-300 hover:bg-white/10 disabled:opacity-50",
                        gazeNavigation.isActionFocused("youtube-search-submit") && "border-emerald-300/90 bg-emerald-500/20 text-emerald-100",
                    )}
                >
                    <Search size={20} />
                </button>
            </form>

            {isSearching ? (
                <div className="flex justify-center py-20">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                </div>
            ) : hasSearched && results.length === 0 ? (
                <div className="text-center py-20 text-zinc-400">No results found for "{query}"</div>
            ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {results.map((video) => (
                        <div
                            key={video.id}
                            onClick={() => onSelectVideo(video)}
                            data-gaze-action-id={`youtube-video-${video.id}`}
                            className={cn(
                                "group flex cursor-pointer flex-col overflow-hidden rounded-xl bg-transparent transition-all",
                                gazeNavigation.isActionFocused(`youtube-video-${video.id}`) && "ring-2 ring-emerald-300/80 ring-offset-2 ring-offset-[#040812]",
                            )}
                        >
                            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/5 bg-zinc-900">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={video.thumbnailUrl}
                                    alt={video.title}
                                    loading="lazy"
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                />
                            </div>
                            <div className="mt-3 flex gap-3 px-1">
                                <div className="flex flex-col items-start gap-1">
                                    <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-white group-hover:text-amber-400">
                                        {video.title}
                                    </h3>
                                    <span className="text-xs text-zinc-400">{video.channelTitle}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {gazeNavigation.gazeControlEnabled && (
                <div className="pointer-events-none fixed left-4 top-4 z-40 rounded bg-black/70 px-3 py-2 text-sm text-white">
                    <p>Live preview</p>
                    <p className="text-xs text-white/70">Status: {gazeNavigation.livePreviewStatus}</p>
                    {gazeNavigation.livePreviewError && (
                        <p className="mt-1 text-xs text-red-300">{gazeNavigation.livePreviewError}</p>
                    )}
                </div>
            )}

            {gazeNavigation.authError && (
                <p className="mt-3 rounded-md border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {gazeNavigation.authError}
                </p>
            )}
        </div>
    )
}
