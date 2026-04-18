import { createDb } from "@app/db";
import {
  accounts,
  sessions,
  users,
  verifications,
} from "@app/db/schema/index";
import { env } from "@app/env/server";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";

const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
};

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    user: {
      modelName: "users",
      additionalFields: {
        kbId: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    account: {
      modelName: "accounts",
    },
    session: {
      modelName: "sessions",
    },
    verification: {
      modelName: "verifications",
    },
    trustedOrigins: [
      env.CORS_ORIGIN,
      "app://",
      ...(env.NODE_ENV === "development"
        ? ["exp://", "exp://**", "exp://192.168.*.*:*/**", "http://localhost:8081"]
        : []),
    ],
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      database: {
        generateId: "uuid",
      },
      defaultCookieAttributes: {
        sameSite: env.NODE_ENV === "production" ? "none" : "lax",
        secure: env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    plugins: [expo(), bearer()],
  });
}

export const auth = createAuth();
