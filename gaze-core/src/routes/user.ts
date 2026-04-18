import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema";
import { auth } from "../lib/auth";
import { authSchemas } from "../lib/schemas";
import type { UserProfileChanges, UserResponse, UserRow } from "../types/user";

const updateProfileBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  image: t.Optional(t.String()),
});

const errorResponse = (error: string, message: string) => ({ error, message });

const toUserResponse = (row: UserRow): UserResponse => ({
  id: row.id,
  email: row.email,
  name: row.name,
  image: row.image,
  emailVerified: row.emailVerified,
  createdAt: row.createdAt,
});

async function resolveSessionUser(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  return sessionData?.user ?? null;
}

export const userRoutes = new Elysia({ prefix: "/users" })
  .get(
    "/me",
    async ({ request, set }) => {
      const sessionUser = await resolveSessionUser(request);
      if (!sessionUser) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      const result = await db.select().from(user).where(eq(user.id, sessionUser.id));
      const found = result[0];
      if (!found) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return toUserResponse(found);
    },
    {
      detail: {
        tags: ["Users"],
      },
      response: {
        200: authSchemas.user,
        401: authSchemas.error,
        404: authSchemas.error,
      },
    }
  )
  .patch(
    "/me",
    async ({ request, body, set }) => {
      const sessionUser = await resolveSessionUser(request);
      if (!sessionUser) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      const changes: UserProfileChanges = {};
      if (body.name !== undefined) changes.name = body.name;
      if (body.image !== undefined) changes.image = body.image;

      const updated =
        Object.keys(changes).length > 0
          ? await db
              .update(user)
              .set({ ...changes, updatedAt: new Date() })
              .where(eq(user.id, sessionUser.id))
              .returning()
          : await db.select().from(user).where(eq(user.id, sessionUser.id));

      const found = updated[0];
      if (!found) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return toUserResponse(found);
    },
    {
      body: updateProfileBody,
      detail: {
        tags: ["Users"],
      },
      response: {
        200: authSchemas.user,
        401: authSchemas.error,
        404: authSchemas.error,
      },
    }
  )
  .get(
    "/:id",
    async ({ params: { id }, set }) => {
      const result = await db.select().from(user).where(eq(user.id, id));
      const found = result[0];

      if (!found) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return toUserResponse(found);
    },
    {
      detail: {
        tags: ["Users"],
      },
      response: {
        200: authSchemas.user,
        404: authSchemas.error,
      },
    }
  );
