import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
    // Use same-origin requests and proxy /api/auth from Next to backend.
    baseURL: "",
    fetchOptions: {
        credentials: "include",
    },
})

export const { signIn, signUp, signOut, useSession, getSession } = authClient
