import { auth } from "@app/auth";
import { Elysia } from "elysia";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createKnowledgeBase } from "@/modules/assistance/autosage.service";
import { ApiError } from "@/utils/api-error";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  kbId: string | null;
};

type AuthCredentials = {
  email: string;
  password: string;
  name?: string;
};

const publicUserSelection = {
  id: users.id,
  email: users.email,
  name: users.name,
  kbId: users.kbId,
};

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = Reflect.get(error, "status");

  return typeof candidate === "number" ? candidate : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const directCode = Reflect.get(error, "code");
  if (typeof directCode === "string") {
    return directCode;
  }

  const body = Reflect.get(error, "body");
  if (typeof body === "object" && body !== null) {
    const bodyCode = Reflect.get(body, "code");
    return typeof bodyCode === "string" ? bodyCode : undefined;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const directMessage = Reflect.get(error, "message");
  if (typeof directMessage === "string") {
    return directMessage;
  }

  const body = Reflect.get(error, "body");
  if (typeof body === "object" && body !== null) {
    const bodyMessage = Reflect.get(body, "message");
    if (typeof bodyMessage === "string") {
      return bodyMessage;
    }
  }

  return undefined;
}

function normalizeSignUpError(error: unknown): ApiError {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  const message = getErrorMessage(error)?.toLowerCase();

  if (
    status === 409
    || code?.includes("USER_ALREADY_EXISTS")
    || message?.includes("already exists")
  ) {
    return new ApiError(409, "email_already_in_use", "EMAIL_ALREADY_IN_USE");
  }

  if (code?.includes("INVALID_ORIGIN") || message?.includes("origin")) {
    return new ApiError(403, "invalid_origin", "INVALID_ORIGIN");
  }

  return new ApiError(status ?? 400, "signup_failed", "SIGNUP_FAILED");
}

function normalizeSignInError(error: unknown): ApiError {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);

  if (status === 401 || code?.includes("INVALID") || code?.includes("UNAUTHORIZED")) {
    return new ApiError(401, "invalid_credentials", "INVALID_CREDENTIALS");
  }

  return new ApiError(status ?? 400, "login_failed", "LOGIN_FAILED");
}

async function getPublicUserById(userId: string): Promise<PublicUser> {
  const [user] = await db.select(publicUserSelection).from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new ApiError(401, "unauthorized", "UNAUTHORIZED");
  }

  return user;
}

function parseKnowledgeBaseProvisionFailureCause(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const details = Reflect.get(error, "details");
  if (typeof details === "object" && details !== null) {
    return details as Record<string, unknown>;
  }

  const directBody = Reflect.get(error, "body");
  if (typeof directBody === "object" && directBody !== null) {
    return directBody as Record<string, unknown>;
  }

  const directMessage = Reflect.get(error, "message");
  if (typeof directMessage !== "string" || directMessage.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(directMessage);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function ensureKnowledgeBaseForUser(
  userId: string,
  options?: { strict?: boolean },
): Promise<PublicUser> {
  const strict = options?.strict ?? true;
  const existingUser = await getPublicUserById(userId);

  if (existingUser.kbId) {
    return existingUser;
  }

  let kbId: string;

  try {
    kbId = await createKnowledgeBase(userId, existingUser.name);
  } catch (error) {
    if (!strict) {
      return existingUser;
    }

    if (error instanceof ApiError) {
      const parsedCause = parseKnowledgeBaseProvisionFailureCause(error);

      throw new ApiError(
        502,
        "knowledge_base_provision_failed",
        "KNOWLEDGE_BASE_PROVISION_FAILED",
        {
          userId,
          cause: error.code,
          ...(parsedCause ? { autosage: parsedCause } : {}),
        },
      );
    }

    const parsedCause = parseKnowledgeBaseProvisionFailureCause(error);

    throw new ApiError(502, "knowledge_base_provision_failed", "KNOWLEDGE_BASE_PROVISION_FAILED", {
      userId,
      ...(parsedCause ? { autosage: parsedCause } : {}),
    });
  }

  const [updatedUser] = await db
    .update(users)
    .set({ kbId })
    .where(and(eq(users.id, userId), isNull(users.kbId)))
    .returning(publicUserSelection);

  if (updatedUser) {
    return updatedUser;
  }

  return getPublicUserById(userId);
}

async function deleteUserById(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

async function signUp(credentials: Required<AuthCredentials>, headers: Headers): Promise<{ token: string; user: PublicUser }> {
  let result: Awaited<ReturnType<typeof auth.api.signUpEmail>>;

  try {
    result = await auth.api.signUpEmail({
      body: credentials,
      headers,
    });
  } catch (error) {
    throw normalizeSignUpError(error);
  }

  if (!result.token) {
    throw new ApiError(502, "auth_token_not_issued", "AUTH_TOKEN_NOT_ISSUED");
  }

  try {
    const updatedUser = await ensureKnowledgeBaseForUser(result.user.id, { strict: true });

    return {
      token: result.token,
      user: updatedUser,
    };
  } catch (error) {
    await deleteUserById(result.user.id);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(502, "autosage_signup_failed", "AUTOSAGE_SIGNUP_FAILED");
  }
}

async function signIn(credentials: AuthCredentials, headers: Headers): Promise<{ token: string; user: PublicUser }> {
  let result: Awaited<ReturnType<typeof auth.api.signInEmail>>;

  try {
    result = await auth.api.signInEmail({
      body: {
        email: credentials.email,
        password: credentials.password,
      },
      headers,
    });
  } catch (error) {
    throw normalizeSignInError(error);
  }

  if (!result.token) {
    throw new ApiError(502, "auth_token_not_issued", "AUTH_TOKEN_NOT_ISSUED");
  }

  return {
    token: result.token,
    user: await ensureKnowledgeBaseForUser(result.user.id, { strict: true }),
  };
}

async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

async function requireSession(headers: Headers) {
  const session = await getSession(headers);

  if (!session) {
    throw new ApiError(401, "unauthorized", "UNAUTHORIZED");
  }

  return session;
}

async function requireAuthContext(headers: Headers): Promise<{ currentUser: PublicUser; currentSession: Awaited<ReturnType<typeof requireSession>>["session"] }> {
  const session = await requireSession(headers);

  return {
    currentUser: await getPublicUserById(session.user.id),
    currentSession: session.session,
  };
}

async function getCurrentUser(headers: Headers): Promise<PublicUser> {
  const { currentUser } = await requireAuthContext(headers);
  return currentUser;
}

export const authService = {
  ensureKnowledgeBaseForUser,
  getCurrentUser,
  getPublicUserById,
  getSession,
  requireAuthContext,
  requireSession,
  signIn,
  signUp,
};

export const authHandlerPlugin = new Elysia({ name: "focuslayer.auth.handler" }).mount(auth.handler);

export const authContextPlugin = new Elysia({ name: "focuslayer.auth.context" })
  .macro({
    auth: {
      async resolve({ request }) {
        return authService.requireAuthContext(request.headers);
      },
    },
  });
