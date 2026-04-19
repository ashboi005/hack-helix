"use client"

import { useEffect, useState, useCallback } from "react"
import { useYouTubeApi, type YouTubeVideo, type YouTubeComment } from "@/hooks/use-youtube-api"
import { useGazeAttentionTracker } from "@/components/youtube/gaze-attention-tracker"
import { Space_Grotesk } from "next/font/google"
import { UniversalGridDebugOverlay } from "@/hooks/use-universal-grid-tracker"
import { cn } from "@/lib/utils"

const spaceGrotesk = Space_Grotesk({
    subsets: ["latin"],
    weight: ["500", "600", "700"],
})

interface YouTubePlayerViewProps {
    video: YouTubeVideo
    onBack: () => void
    onSelectRelated?: (video: YouTubeVideo) => void
}

export function YouTubePlayerView({ video, onBack, onSelectRelated }: YouTubePlayerViewProps) {
    const { getComments, getRelatedVideos } = useYouTubeApi()
    const [comments, setComments] = useState<YouTubeComment[]>([])
    const [related, setRelated] = useState<YouTubeVideo[]>([])

    const {
        blurPeripheral,
        iframeRef,
        currentZone,
        cursorPosition,
        isGazeActive,
        livePreviewStatus,
        livePreviewError,
        isActionFocused,
    } = useGazeAttentionTracker(video)

    useEffect(() => {
        getComments(video.id).then(setComments)
        getRelatedVideos(video.id, video.channelId).then(setRelated)
    }, [video.id, video.channelId, getComments, getRelatedVideos])

    const [isFullscreen, setIsFullscreen] = useState(false)

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement)
        document.addEventListener('fullscreenchange', handler)
        return () => document.removeEventListener('fullscreenchange', handler)
    }, [])

    const toggleFullscreen = useCallback(() => {
        const wrapper = document.getElementById('video-wrapper')
        if (!wrapper) return
        if (document.fullscreenElement) {
            document.exitFullscreen()
        } else {
            wrapper.requestFullscreen()
        }
    }, [])

    return (
        <div className={`relative flex h-screen w-full flex-col bg-[#040812] overflow-hidden ${spaceGrotesk.className}`}>
            {isGazeActive && (
                <span
                    className="pointer-events-none fixed z-50 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]"
                    style={{ left: cursorPosition.x, top: cursorPosition.y }}
                />
            )}

            {/* Top Navbar */}
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-6 backdrop-blur-md z-10 shrink-0">
                <button
                    onClick={onBack}
                    data-gaze-action-id="youtube-player-back"
                    className={cn(
                        "inline-flex items-center rounded-full border border-white/20 bg-white/5 py-1.5 px-4 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-300 transition-colors hover:bg-white/10 relative z-20",
                        isActionFocused("youtube-player-back") && "border-emerald-300/90 bg-emerald-500/20 text-emerald-100",
                    )}
                >
                    ← Back to Search
                </button>
                <span className="text-sm font-semibold tracking-wide text-zinc-400">Now Playing</span>
            </div>

            {/* Main Grid Layout */}
            {/* 
        This mirrors a standard 3x3 Grid mathematically for our UseUniversalGridTracker
        We use a flex layout here, but semantically:
        - The left 2 columns are video (top 2 rows) and comments (bottom row)
        - The right 1 column is suggested videos (all 3 rows)
      */}
            <div className="flex flex-1 overflow-hidden">

                {/* Left Side (Video + Comments) */}
                <div className="flex h-full flex-[3] flex-col relative w-full">
                    {/* Video Container */}
                    <div className={`flex-[3] relative flex items-center justify-center p-4 transition-all duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] z-20 ${blurPeripheral ? 'scale-[1.12] translate-y-6' : 'scale-100'}`}>
                        <div id="video-wrapper" className="bg-black w-full h-full rounded-[24px] overflow-hidden shadow-2xl ring-1 ring-white/10 relative group transition-all duration-1000">
                            {/* Blocker for YouTube top bar (title/share buttons) */}
                            <div className="absolute top-0 left-0 right-0 h-16 z-20 pointer-events-auto cursor-default" />

                            {/* Fullscreen toggle button — always on top, always clickable */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFullscreen();
                                }}
                                data-gaze-action-id="youtube-player-fullscreen"
                                className={cn(
                                    "absolute bottom-4 right-4 z-30 bg-black/70 hover:bg-black/90 text-white p-3 rounded-xl backdrop-blur-md border border-white/20 transition-all shadow-lg hover:scale-110 active:scale-95 flex items-center justify-center",
                                    isFullscreen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                    isActionFocused("youtube-player-fullscreen") && "border-emerald-300/90 bg-emerald-500/30",
                                )}
                                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                            >
                                {isFullscreen ? (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4H4m0 0l5 5M9 15v5H4m0 0l5-5m6-6V4h5m0 0l-5 5m0 6v5h5m0 0l-5-5" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                    </svg>
                                )}
                            </button>

                            <iframe
                                ref={iframeRef}
                                src={`https://www.youtube.com/embed/${video.id}?rel=0&enablejsapi=1&modestbranding=1&iv_load_policy=3&controls=1`}
                                title={video.title}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                className="w-full h-full border-0"
                            />
                        </div>
                    </div>

                    {/* Comments Section */}
                    <div className={`flex-1 overflow-y-auto custom-scrollbar px-8 transition-all duration-700 pb-8 z-10 ${blurPeripheral ? 'blur-sm opacity-40 pointer-events-none' : 'blur-none opacity-100'}`}>
                        <h2 className="text-xl font-semibold mb-4 text-white">Comments</h2>
                        <div className="flex flex-col gap-4">
                            {comments.map((c) => (
                                <div key={c.id} className="flex gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={c.authorProfileImageUrl} alt={c.authorDisplayName} className="w-10 h-10 rounded-full" />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm text-zinc-200">{c.authorDisplayName}</span>
                                            <span className="text-xs text-zinc-500">{new Date(c.publishedAt).toLocaleDateString()}</span>
                                        </div>
                                        <p className="text-sm mt-1 text-zinc-300" dangerouslySetInnerHTML={{ __html: c.textDisplay }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Side (Suggested / Peripheral) */}
                <div className={`flex-[1] flex h-full flex-col overflow-y-auto custom-scrollbar border-l border-white/10 bg-[#070e1a]/50 p-4 transition-all duration-700 z-10 ${blurPeripheral ? 'blur-sm opacity-40 pointer-events-none' : 'blur-none opacity-100'}`}>
                    <h2 className="text-lg font-semibold mb-4 text-white">Suggested</h2>
                    <div className="flex flex-col gap-4">
                        {related.map(rv => (
                            <div
                                key={rv.id}
                                onClick={() => onSelectRelated?.(rv)}
                                data-gaze-action-id={`youtube-related-${rv.id}`}
                                className={cn(
                                    "flex gap-3 cursor-pointer group rounded-lg border border-transparent p-1 transition-colors",
                                    isActionFocused(`youtube-related-${rv.id}`) && "border-emerald-300/80 bg-emerald-500/15",
                                )}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={rv.thumbnailUrl} alt={rv.title} className="w-32 h-20 object-cover rounded-lg border border-white/5 flex-shrink-0" />
                                <div className="flex flex-col">
                                    <h4 className="text-xs font-semibold text-zinc-200 line-clamp-2 group-hover:text-amber-400">{rv.title}</h4>
                                    <span className="text-[10px] text-zinc-500 mt-1">{rv.channelTitle}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>

            {/* Debug Grid (Set to active by default to visualize tracker setup) */}


            {isGazeActive && (
                <div className="pointer-events-none fixed left-4 top-4 z-40 rounded bg-black/70 px-3 py-2 text-sm text-white">
                    <p>Live preview</p>
                    <p className="text-xs text-white/70">Status: {livePreviewStatus}</p>
                    {livePreviewError && (
                        <p className="mt-1 text-xs text-red-300">{livePreviewError}</p>
                    )}
                </div>
            )}
        </div>
    )
}
