import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    AUTOSAGE_BASE_URL: z.url(),
    AUTOSAGE_TENANT_ID: z.string().min(1),
    AUTOSAGE_API_KEY: z.string().min(1),
    GROQ_API_KEY: z.string().min(1),
    GAZE_BASE_URL: z.url(),
    GAZE_API_KEY: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
