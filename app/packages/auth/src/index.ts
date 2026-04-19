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
import { eq } from "drizzle-orm";

const authSchema = {
  users,
  sessions,
  accounts,
  verifications,
};

function getNestedValue(payload: unknown, path: string[]): unknown {
  let current: unknown = payload;

  for (const segment of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    current = Reflect.get(current, segment);
  }

  return current;
}

function getFirstString(payload: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = getNestedValue(payload, path);

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function buildKnowledgeBaseName(userId: string, userName?: string | null): string {
  const normalizedName = (userName ?? "").trim().replace(/\s+/g, " ");
  const fallback = `user-${userId.slice(0, 8)}`;
  const base = normalizedName.length > 0 ? normalizedName : fallback;
  const withSuffix = `${base} (${userId.slice(0, 8)})`;
  return withSuffix.length > 255 ? withSuffix.slice(0, 255) : withSuffix;
}

async function createKnowledgeBaseForUser(userId: string, userName?: string | null): Promise<string> {
  const kbName = buildKnowledgeBaseName(userId, userName);

  const response = await fetch(new URL("/api/v1/knowledge-bases/", env.AUTOSAGE_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AUTOSAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: env.AUTOSAGE_TENANT_ID.trim(),
      name: kbName,
      description: `Knowledge base for ${kbName}`,
      persona: "",
      customPrompt: "",
    }),
  });

  const rawBody = await response.text();

  let payload: unknown = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = rawBody;
    }
  }

  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        code: "AUTOSAGE_REQUEST_FAILED",
        status: response.status,
        payload,
      }),
    );
  }

  const kbId = getFirstString(payload, [
    ["id"],
    ["data", "id"],
    ["knowledgeBase", "id"],
    ["data", "knowledgeBase", "id"],
    ["knowledge_base_id"],
    ["data", "knowledge_base_id"],
    ["kb_id"],
    ["data", "kb_id"],
  ]);

  if (!kbId) {
    throw new Error(
      JSON.stringify({
        code: "AUTOSAGE_INVALID_RESPONSE",
        payload,
      }),
    );
  }

  return kbId;
}

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
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const currentUser = await db.query.users.findFirst({
              where: eq(users.id, user.id),
              columns: {
                id: true,
                kbId: true,
              },
            });

            if (!currentUser || currentUser.kbId) {
              return;
            }

            const kbId = await createKnowledgeBaseForUser(currentUser.id, user.name);

            await db
              .update(users)
              .set({ kbId })
              .where(eq(users.id, currentUser.id));
          },
        },
      },
    },
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
