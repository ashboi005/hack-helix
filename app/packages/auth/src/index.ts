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
  users,
  sessions,
  accounts,
  verifications,
};

function toOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function buildTrustedOrigins() {
  const trustedOrigins = new Set<string>();

  trustedOrigins.add("app://");
  trustedOrigins.add(env.CORS_ORIGIN);

  const betterAuthOrigin = toOrigin(env.BETTER_AUTH_URL);
  if (betterAuthOrigin) {
    trustedOrigins.add(betterAuthOrigin);
  }

  if (env.NODE_ENV === "development") {
    [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3002",
      "http://127.0.0.1:5173",
      "http://localhost:8081",
      "exp://",
      "exp://**",
      "exp://192.168.*.*:*/**",
    ].forEach((origin) => trustedOrigins.add(origin));
  }

  return Array.from(trustedOrigins);
}

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
    trustedOrigins: buildTrustedOrigins(),
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
