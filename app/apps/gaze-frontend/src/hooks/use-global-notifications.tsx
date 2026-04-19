"use client"

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"

export type NotificationType = "info" | "warning" | "success" | "action"

export type NotificationAction = {
    label: string
    onClick: () => void | Promise<void>
    primary?: boolean
}

export type NotificationPayload = {
    id: string
    title: string
    message: string
    type?: NotificationType
    durationMs?: number // 0 = persistent
    action?: NotificationAction
    secondaryAction?: NotificationAction
}

type NotificationContextType = {
    addNotification: (payload: Omit<NotificationPayload, "id">) => string
    removeNotification: (id: string) => void
    notifications: NotificationPayload[]
}

const NotificationContext = createContext<NotificationContextType | null>(null)

export function useGlobalNotifications() {
    const context = useContext(NotificationContext)
    if (!context) {
        throw new Error("useGlobalNotifications must be used within a NotificationProvider")
    }
    return context
}

export function NotificationProvider({ children }: { children: ReactNode }) {
    const [notifications, setNotifications] = useState<NotificationPayload[]>([])
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const addNotification = useCallback((payload: Omit<NotificationPayload, "id">) => {
        const id = Math.random().toString(36).substring(2, 9)
        const newNotification = { ...payload, id }
        setNotifications((prev) => [...prev, newNotification])

        if (payload.durationMs !== 0) {
            setTimeout(() => {
                setNotifications((prev) => prev.filter((n) => n.id !== id))
            }, payload.durationMs || 5000)
        }

        return id
    }, [])

    const removeNotification = useCallback((id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id))
    }, [])

    return (
        <NotificationContext.Provider value={{ addNotification, removeNotification, notifications }}>
            {children}
            {mounted && createPortal(
                <div className="fixed bottom-6 right-6 z-[100] flex max-w-sm flex-col gap-3 pointer-events-none">
                    <AnimatePresence>
                        {notifications.map((notif) => (
                            <motion.div
                                key={notif.id}
                                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                                className={`pointer-events-auto flex flex-col gap-2 rounded-xl border border-white/10 p-4 shadow-2xl backdrop-blur-md ${notif.type === "warning" ? "bg-amber-500/10 border-amber-500/20" :
                                        notif.type === "success" ? "bg-emerald-500/10 border-emerald-500/20" :
                                            notif.type === "action" ? "bg-cyan-500/10 border-cyan-500/20" :
                                                "bg-[#0b1324]/90"
                                    }`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h4 className="text-sm font-semibold text-zinc-100">{notif.title}</h4>
                                        <p className="mt-1 text-sm text-zinc-300">{notif.message}</p>
                                    </div>
                                    <button
                                        onClick={() => removeNotification(notif.id)}
                                        className="text-zinc-500 hover:text-zinc-300"
                                    >
                                        ×
                                    </button>
                                </div>
                                {(notif.action || notif.secondaryAction) && (
                                    <div className="mt-2 flex items-center gap-2">
                                        {notif.secondaryAction && (
                                            <button
                                                onClick={() => {
                                                    notif.secondaryAction!.onClick()
                                                    removeNotification(notif.id)
                                                }}
                                                className="flex-1 rounded-md border border-white/10 bg-white/5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/10"
                                            >
                                                {notif.secondaryAction.label}
                                            </button>
                                        )}
                                        {notif.action && (
                                            <button
                                                onClick={() => {
                                                    notif.action!.onClick()
                                                    removeNotification(notif.id)
                                                }}
                                                className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${notif.action.primary
                                                        ? "bg-amber-300 text-amber-950 hover:bg-amber-400"
                                                        : "bg-white/10 text-white hover:bg-white/20"
                                                    }`}
                                            >
                                                {notif.action.label}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>,
                document.body
            )}
        </NotificationContext.Provider>
    )
}
