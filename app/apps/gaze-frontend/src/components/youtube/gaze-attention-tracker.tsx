"use client"

import { useEffect, useRef, useState } from "react"
import { useGazeActionNavigation } from "@/hooks/use-gaze-action-navigation"
import { useGlobalNotifications } from "@/hooks/use-global-notifications"
import type { YouTubeVideo } from "@/hooks/use-youtube-api"

export function useGazeAttentionTracker(video: YouTubeVideo) {
    const gazeNav = useGazeActionNavigation()
    const { livePreviewActive, cursorPosition } = gazeNav
    const notifications = useGlobalNotifications()

    const iframeRef = useRef<HTMLIFrameElement>(null)

    const [blurPeripheral, setBlurPeripheral] = useState(false)
    const isVideoPausedRef = useRef(false)
    const [currentZone, setCurrentZone] = useState("unknown")

    // Timers to track dwell time
    const focusTimeRef = useRef(0)
    const distractionTimeRef = useRef(0)
    const erraticCountRef = useRef(0)
    const lastPeripheralNotificationAtRef = useRef(0)

    // State to avoid re-triggering notifications constantly
    const aiSummaryCooldownRef = useRef(false)
    const lastZoneRef = useRef<string | null>(null)

    // UI state to show the lack-of-focus overlay
    const [isVideoPaused, setIsVideoPaused] = useState(false)

    const activeRef = useRef(livePreviewActive)
    const pointRef = useRef(cursorPosition)

    useEffect(() => {
        activeRef.current = livePreviewActive
        pointRef.current = cursorPosition
    }, [livePreviewActive, cursorPosition])

    useEffect(() => {
        if (!livePreviewActive) {
            setBlurPeripheral(false)
            setCurrentZone("unknown")
            focusTimeRef.current = 0
            distractionTimeRef.current = 0
            lastZoneRef.current = null
            return
        }

        const tick = setInterval(() => {
            const point = pointRef.current
            if (!point) {
                setCurrentZone((prev) => (prev === "unknown" ? prev : "unknown"))
                return
            }
            const now = Date.now()

            const videoEl = document.getElementById("video-wrapper")
            const commentsEl = document.getElementById("comments-wrapper")
            const suggestedEl = document.getElementById("suggested-wrapper")

            let inVideo = false
            let inComments = false
            let inSuggested = false

            const checkEl = (el: HTMLElement | null) => {
                if (!el) return false
                const rect = el.getBoundingClientRect()
                // Require looking generally inside the element box
                return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
            }

            inVideo = checkEl(videoEl)
            inComments = checkEl(commentsEl)
            inSuggested = checkEl(suggestedEl)

            const nextZone = inVideo ? 'video' : inComments ? 'comments' : inSuggested ? 'suggested' : 'unknown'
            setCurrentZone(nextZone) // React will batch identical state updates smoothly

            // Remove erratic movement detection. We will trigger the summary based on absolute distraction time below.
            lastZoneRef.current = nextZone

            if (inVideo) {
                focusTimeRef.current += 100
                distractionTimeRef.current = 0
                lastPeripheralNotificationAtRef.current = 0

                // After 1 second of looking at the video, blur the peripheral (comments/suggested)
                if (focusTimeRef.current >= 1000) {
                    setBlurPeripheral(true)
                }

                // Auto-resume if the tracker had paused the video
                if (isVideoPausedRef.current) {
                    iframeRef.current?.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*')
                    isVideoPausedRef.current = false
                    setIsVideoPaused(false)
                }
                return
            }

            distractionTimeRef.current += 100
            focusTimeRef.current = 0

            // Instantly unblur if not looking at video
            setBlurPeripheral(false)

            // Pause if not looking at video for 3 seconds
            if (distractionTimeRef.current >= 3000 && !isVideoPausedRef.current) {
                iframeRef.current?.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*')
                isVideoPausedRef.current = true
                setIsVideoPaused(true)
            }

            // Only notify if deeply distracted (4s+) and at most once per 15 seconds.
            const notifCooldown = 15000
            if (distractionTimeRef.current > 4000 && now - lastPeripheralNotificationAtRef.current > notifCooldown) {
                lastPeripheralNotificationAtRef.current = now
                notifications.addNotification({
                    title: "Focus Reminder",
                    message:
                        nextZone === "comments"
                            ? "You are focused on comments. Return your gaze to the video to continue learning."
                            : nextZone === "suggested"
                                ? "You are focused on suggested videos. Return your gaze to the main video to stay on track."
                                : "Your gaze moved away from the lesson focus area. Return to the main video to continue.",
                    type: "warning",
                    durationMs: 4500,
                    action: {
                        label: "Resume Video",
                        primary: true,
                        onClick: () => {
                            iframeRef.current?.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*')
                            isVideoPausedRef.current = false
                            distractionTimeRef.current = 0
                            setIsVideoPaused(false)
                        }
                    }
                })
            }

        }, 100)

        return () => clearInterval(tick)
    }, [livePreviewActive, notifications])


    return {
        blurPeripheral,
        iframeRef,
        isGazeActive: livePreviewActive,
        currentZone,
        cursorPosition: cursorPosition,
        livePreviewStatus: gazeNav.livePreviewStatus,
        livePreviewError: gazeNav.livePreviewError,
        isActionFocused: gazeNav.isActionFocused,
        isVideoPaused,
    }
}
