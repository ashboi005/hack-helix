export {}

process.env.PORT = "3001"
process.env.BETTER_AUTH_URL = "http://localhost:3001"

await import("./index")