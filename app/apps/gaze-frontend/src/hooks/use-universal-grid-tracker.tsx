"use client"

import { useEffect, useState, useMemo } from "react"
import { useGazeActionNavigation } from "@/hooks/use-gaze-action-navigation"

// A 4x4 Grid layout
// Rows: 0 to 3
// Cols: 0 to 3
// Grid Box Index = Row * 4 + Col  (0 to 15)

export type GridDimension = 3 | 4

export function useUniversalGridTracker(dimension: GridDimension = 4) {
    const gazeNavigation = useGazeActionNavigation()
    const [activeBoxIndex, setActiveBoxIndex] = useState<number | null>(null)

    // NOTE: We only use the authentic cursorPosition when gazeControlEnabled AND livePreviewActive is true.
    // We DO NOT fallback to mouse tracking.

    const x = gazeNavigation.cursorPosition.x
    const y = gazeNavigation.cursorPosition.y

    const isGazeActive = gazeNavigation.gazeControlEnabled && gazeNavigation.livePreviewActive

    useEffect(() => {
        if (!isGazeActive) {
            setActiveBoxIndex(null)
            return
        }

        // Only update if we have actual coordinates inside viewport
        if (x < 0 || y < 0) {
            setActiveBoxIndex(null)
            return
        }

        const vw = window.innerWidth
        const vh = window.innerHeight

        const colWidth = vw / dimension
        const rowHeight = vh / dimension

        const col = Math.floor(Math.max(0, Math.min(x, vw - 1)) / colWidth)
        const row = Math.floor(Math.max(0, Math.min(y, vh - 1)) / rowHeight)

        const boxIndex = row * dimension + col
        setActiveBoxIndex(boxIndex)
    }, [x, y, dimension, isGazeActive])

    // Helper to map index to logical groups
    const isBoxInGroup = (boxIndices: number[]) => {
        if (activeBoxIndex === null) return false
        return boxIndices.includes(activeBoxIndex)
    }

    return {
        activeBoxIndex,
        dimension,
        isBoxInGroup,
        isGazeActive,
        rawX: x,
        rawY: y,
        cursorPosition: gazeNavigation.cursorPosition,
        livePreviewStatus: gazeNavigation.livePreviewStatus,
        livePreviewError: gazeNavigation.livePreviewError,
        isActionFocused: gazeNavigation.isActionFocused,
    }
}

// Optional Debug Overlay
export function UniversalGridDebugOverlay({ dimension = 4 }: { dimension?: GridDimension }) {
    const { activeBoxIndex } = useUniversalGridTracker(dimension)

    const totalBoxes = dimension * dimension

    return (
        <div className="pointer-events-none fixed inset-0 z-50 grid w-full h-full" style={{ gridTemplateColumns: `repeat(${dimension}, 1fr)`, gridTemplateRows: `repeat(${dimension}, 1fr)` }}>
            {Array.from({ length: totalBoxes }).map((_, i) => (
                <div
                    key={i}
                    className={`border border-red-500/20 flex items-center justify-center text-red-500/30 text-2xl font-bold transition-colors ${activeBoxIndex === i ? 'bg-red-500/10 border-red-500/60 text-red-500/80' : ''}`}
                >
                    {i}
                </div>
            ))}
        </div>
    )
}
