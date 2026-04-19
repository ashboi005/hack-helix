"use client"

import { useEffect, useRef, useState } from "react"
import { useUniversalGridTracker } from "@/hooks/use-universal-grid-tracker"
import { useGlobalNotifications } from "@/hooks/use-global-notifications"
import type { YouTubeVideo } from "@/hooks/use-youtube-api"

/* 
  Grid Layout Mapping (4x4):
  Col: 0 1 2 3
  Row 0: 0,  1,  2,  3
  Row 1: 4,  5,  6,  7
  Row 2: 8,  9,  10, 11
  Row 3: 12, 13, 14, 15

  Our Layout in `youtube-player-view`:
  Left side gets flex-[3] = 75% width, Right side gets flex-[1] = 25% width.
  Inside Left side, Top Video gets flex-[3], Bottom Comments gets flex-[1].

  Zone mapping (4x4 aligns with 75%/25% split):
  Video Player: left 3 cols × top 3 rows
    Cols 0, 1, 2 | Rows 0, 1, 2
    Indices: 0, 1, 2, 4, 5, 6, 8, 9, 10
  Comments: left 3 cols × bottom row
    Cols 0, 1, 2 | Row 3
    Indices: 12, 13, 14
  Suggested: right col × all rows
    Col 3 | Rows 0, 1, 2, 3
    Indices: 3, 7, 11, 15
*/

const ZONES = {
    VIDEO: [0, 1, 2, 4, 5, 6, 8, 9, 10],
    COMMENTS: [12, 13, 14],
    SUGGESTED: [3, 7, 11, 15]
}

export function useGazeAttentionTracker(video: YouTubeVideo) {
    const grid = useUniversalGridTracker(4)
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

    useEffect(() => {
        if (!grid.isGazeActive) {
            setBlurPeripheral(false)
            setCurrentZone("unknown")
            focusTimeRef.current = 0
            distractionTimeRef.current = 0
            lastZoneRef.current = null
            return
        }

        const tick = setInterval(() => {
            const { isBoxInGroup, activeBoxIndex } = grid
            if (activeBoxIndex === null) {
                setCurrentZone((prev) => (prev === "unknown" ? prev : "unknown"))
                return
            }
            const now = Date.now()

            const inVideo = isBoxInGroup(ZONES.VIDEO)
            const inComments = isBoxInGroup(ZONES.COMMENTS)
            const inSuggested = isBoxInGroup(ZONES.SUGGESTED)

            const nextZone = inVideo ? 'video' : inComments ? 'comments' : inSuggested ? 'suggested' : 'unknown'
            setCurrentZone((prev) => (prev === nextZone ? prev : nextZone))

            // Keep comments/suggested blurred whenever the user is focused on the video area.
            setBlurPeripheral(inVideo)

            // Handle erratic behavior
            if (nextZone !== lastZoneRef.current && nextZone !== 'video') {
                erraticCountRef.current += 1

                if (erraticCountRef.current > 15 && !aiSummaryCooldownRef.current) {
                    aiSummaryCooldownRef.current = true
                    iframeRef.current?.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*')
                    isVideoPausedRef.current = true

                    notifications.addNotification({
                        title: "Distraction Detected",
                        message: "It looks like you're having trouble focusing on the video. Would you like an AI Summary to help you catch up?",
                        type: "action",
                        durationMs: 0,
                        action: {
                            label: "Yes, Generate AI Summary",
                            primary: true,
                            onClick: () => {
                                alert("GENERATING AI SUMMARY: [Mock: This video is about...]")
                                aiSummaryCooldownRef.current = false
                                erraticCountRef.current = 0
                            }
                        },
                        secondaryAction: {
                            label: "No, I'm fine",
                            onClick: () => {
                                aiSummaryCooldownRef.current = false
                                erraticCountRef.current = 0
                                iframeRef.current?.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*')
                            }
                        }
                    })
                }
            }
            lastZoneRef.current = nextZone

            if (inVideo) {
                focusTimeRef.current += 100
                distractionTimeRef.current = 0

                // Auto-resume if the tracker had paused the video
                if (isVideoPausedRef.current) {
                    iframeRef.current?.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*')
                    isVideoPausedRef.current = false
                }
                return
            }

            distractionTimeRef.current += 100
            focusTimeRef.current = 0

            if (distractionTimeRef.current > 10000 && !isVideoPausedRef.current) {
                iframeRef.current?.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*')
                isVideoPausedRef.current = true
            }

            if (now - lastPeripheralNotificationAtRef.current < 7000) {
                return
            }

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
                    }
                }
            })

        }, 100)

        return () => clearInterval(tick)
    }, [grid, notifications])


    return {
        blurPeripheral,
        iframeRef,
        gridIndex: grid.activeBoxIndex,
        isGazeActive: grid.isGazeActive,
        currentZone,
        cursorPosition: grid.cursorPosition,
        livePreviewStatus: grid.livePreviewStatus,
        livePreviewError: grid.livePreviewError,
        isActionFocused: grid.isActionFocused,
    }
}
