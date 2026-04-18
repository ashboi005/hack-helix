import { t } from "elysia";
import { models } from "../db/models";

const userSelect = models.select.user;

/**
 * Authentication validation schemas for request/response bodies
 */
export const authSchemas = {
  // User response (excluding sensitive fields)
  user: t.Object({
    id: userSelect.id,
    email: userSelect.email,
    name: userSelect.name,
    image: userSelect.image,
    emailVerified: userSelect.emailVerified,
    createdAt: userSelect.createdAt,
  }),

  // Error response
  error: t.Object({
    error: t.String(),
    message: t.String(),
  }),
} as const;
