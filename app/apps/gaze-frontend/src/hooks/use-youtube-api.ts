"use client"

import { useState, useCallback } from "react"

export type YouTubeVideo = {
    id: string
    title: string
    description: string
    thumbnailUrl: string
    channelTitle: string
    channelId?: string
    publishedAt: string
}

export type YouTubeComment = {
    id: string
    authorDisplayName: string
    authorProfileImageUrl: string
    textDisplay: string
    likeCount: number
    publishedAt: string
}

export function useYouTubeApi() {
    const [isSearching, setIsSearching] = useState(false)
    const [isLoadingDetails, setIsLoadingDetails] = useState(false)

    // NOTE: In a real environment, fetch from API. 
    // For the frontend demo, we will use mock data if the API fails or no key is provided.
    const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || ""

    const searchVideos = useCallback(async (query: string): Promise<YouTubeVideo[]> => {
        setIsSearching(true)
        try {
            if (!apiKey || !query.trim()) {
                throw new Error("No API key or empty query")
            }

            const res = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=12&q=${encodeURIComponent(
                    query
                )}&type=video&key=${apiKey}`
            )

            if (!res.ok) throw new Error("API Failed")

            const data = await res.json()

            return data.items.map((item: any) => ({
                id: item.id.videoId,
                title: item.snippet.title,
                description: item.snippet.description,
                thumbnailUrl: item.snippet.thumbnails.high.url,
                channelTitle: item.snippet.channelTitle,
                channelId: item.snippet.channelId,
                publishedAt: item.snippet.publishedAt,
            }))
        } catch (e) {
            // Fallback Demo Data for testing UI
            return [
                {
                    id: "jNQXAC9IVRw",
                    title: "Me at the zoo",
                    description: "The first video on YouTube.",
                    thumbnailUrl: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
                    channelTitle: "jawed",
                    publishedAt: "2005-04-24T03:31:52Z",
                },
                {
                    id: "dQw4w9WgXcQ",
                    title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
                    description: "The official video for “Never Gonna Give You Up” by Rick Astley",
                    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                    channelTitle: "Rick Astley",
                    publishedAt: "2009-10-25T06:57:33Z",
                },
                {
                    id: "M7lc1UVf-VE",
                    title: "YouTube Developers Live: Embedded Web Player Customization",
                    description: "Find out how to customize the YouTube embedded player.",
                    thumbnailUrl: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
                    channelTitle: "YouTube Developers",
                    channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
                    publishedAt: "2013-05-30T21:40:55Z",
                }
            ]
        } finally {
            setIsSearching(false)
        }
    }, [apiKey])

    const getComments = useCallback(async (videoId: string): Promise<YouTubeComment[]> => {
        try {
            if (!apiKey) throw new Error("No API key")

            const res = await fetch(
                `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=10&key=${apiKey}`
            )

            if (!res.ok) throw new Error("API Failed")

            const data = await res.json()

            return data.items.map((item: any) => {
                const topLevel = item.snippet.topLevelComment.snippet
                return {
                    id: item.id,
                    authorDisplayName: topLevel.authorDisplayName,
                    authorProfileImageUrl: topLevel.authorProfileImageUrl,
                    textDisplay: topLevel.textDisplay,
                    likeCount: topLevel.likeCount,
                    publishedAt: topLevel.publishedAt,
                }
            })
        } catch (e) {
            return [
                {
                    id: "c1",
                    authorDisplayName: "Test User 1",
                    authorProfileImageUrl: "https://yt3.ggpht.com/a/default-user=s48-c-k-c0x00ffffff-no-rj",
                    textDisplay: "This is a great video representation!",
                    likeCount: 42,
                    publishedAt: new Date().toISOString(),
                },
                {
                    id: "c2",
                    authorDisplayName: "Test User 2",
                    authorProfileImageUrl: "https://yt3.ggpht.com/a/default-user=s48-c-k-c0x00ffffff-no-rj",
                    textDisplay: "Really helpful for learning the topic. But you missed a small detail at 2:30.",
                    likeCount: 15,
                    publishedAt: new Date().toISOString(),
                },
                {
                    id: "c3",
                    authorDisplayName: "Test User 3",
                    authorProfileImageUrl: "https://yt3.ggpht.com/a/default-user=s48-c-k-c0x00ffffff-no-rj",
                    textDisplay: "Wow, the integration looks super smooth.",
                    likeCount: 100,
                    publishedAt: new Date().toISOString(),
                }
            ]
        }
    }, [apiKey])

    const getRelatedVideos = useCallback(async (videoId: string, channelId?: string): Promise<YouTubeVideo[]> => {
        // Fetch up to 4 videos from the same channel, then fallback for remaining
        try {
            if (!apiKey) throw new Error("No API key")

            let channelVideos: YouTubeVideo[] = []
            if (channelId) {
                const channelRes = await fetch(
                    `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=4&type=video&key=${apiKey}`
                )
                if (channelRes.ok) {
                    const channelData = await channelRes.json()
                    channelVideos = channelData.items.map((item: any) => ({
                        id: item.id.videoId,
                        title: item.snippet.title,
                        description: item.snippet.description,
                        thumbnailUrl: item.snippet.thumbnails.high.url,
                        channelTitle: item.snippet.channelTitle,
                        channelId: item.snippet.channelId,
                        publishedAt: item.snippet.publishedAt,
                    })).filter((v: YouTubeVideo) => v.id !== videoId)
                }
            }

            const res = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=6&type=video&key=${apiKey}`
            )

            if (!res.ok && channelVideos.length === 0) throw new Error("API Failed")

            let relatedVideos: YouTubeVideo[] = []
            if (res.ok) {
                const data = await res.json()
                relatedVideos = data.items.map((item: any) => ({
                    id: item.id.videoId,
                    title: item.snippet.title,
                    description: item.snippet.description,
                    thumbnailUrl: item.snippet.thumbnails.high.url,
                    channelTitle: item.snippet.channelTitle,
                    channelId: item.snippet.channelId,
                    publishedAt: item.snippet.publishedAt,
                })).filter((v: YouTubeVideo) => v.id !== videoId && !channelVideos.some(cv => cv.id === v.id))
            }

            // Combine top channel videos and related videos
            return [...channelVideos.slice(0, 4), ...relatedVideos]

        } catch (e) {
            return [
                {
                    id: "qJ_PMvjmC6M",
                    title: "Learn Next.js App Router in 10 Minutes",
                    description: "A quick tutorial on the Next.js app router.",
                    thumbnailUrl: "https://i.ytimg.com/vi/qJ_PMvjmC6M/hqdefault.jpg",
                    channelTitle: "Coding Tutor",
                    publishedAt: new Date().toISOString(),
                },
                {
                    id: "L72fhGm1tfE",
                    title: "React Hooks Explained",
                    description: "Understanding useEffect, useState and more.",
                    thumbnailUrl: "https://i.ytimg.com/vi/L72fhGm1tfE/hqdefault.jpg",
                    channelTitle: "Frontend Mastery",
                    publishedAt: new Date().toISOString(),
                }
            ]
        }
    }, [apiKey])

    return {
        searchVideos,
        getComments,
        getRelatedVideos,
        isSearching,
        isLoadingDetails
    }
}
