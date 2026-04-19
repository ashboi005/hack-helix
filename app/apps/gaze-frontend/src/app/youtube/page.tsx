"use client"
import { useState } from "react"
import { YouTubeSearch } from "@/components/youtube/youtube-search"
import type { YouTubeVideo } from "@/hooks/use-youtube-api"
import { YouTubePlayerView } from "@/components/youtube/youtube-player-view"

export default function YoutubeLmsPage() {
  const [activeVideo, setActiveVideo] = useState<YouTubeVideo | null>(null)

  return (
    <main className="relative min-h-screen bg-[#040812] text-zinc-100 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.1),transparent_34%),radial-gradient(circle_at_84%_85%,rgba(20,184,166,0.1),transparent_36%)]" />

      {!activeVideo ? (
        <YouTubeSearch onSelectVideo={(video) => setActiveVideo(video)} />
      ) : (
        <YouTubePlayerView
          video={activeVideo}
          onBack={() => setActiveVideo(null)}
          onSelectRelated={(video) => setActiveVideo(video)}
        />
      )}
    </main>
  )
}
