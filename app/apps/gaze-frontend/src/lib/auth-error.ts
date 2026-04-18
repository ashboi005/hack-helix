export function getAuthErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
    if (error instanceof Error && error.message) {
        return error.message
    }

    if (typeof error === "object" && error !== null) {
        const maybeMessage = Reflect.get(error, "message")

        if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
            return maybeMessage
        }

        const maybeError = Reflect.get(error, "error")
        if (typeof maybeError === "string" && maybeError.length > 0) {
            return maybeError
        }

        const maybeCode = Reflect.get(error, "code")
        if (typeof maybeCode === "string" && maybeCode.length > 0) {
            return maybeCode
        }

        const maybeStatusText = Reflect.get(error, "statusText")
        if (typeof maybeStatusText === "string" && maybeStatusText.length > 0) {
            return maybeStatusText
        }
    }

    return fallback
}
