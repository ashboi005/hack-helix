import { Elysia, t } from "elysia";

import { authContextPlugin } from "./auth.service";
import { authService } from "./auth.service";

const userSchema = t.Object({
  id: t.String({ format: "uuid" }),
  email: t.String({ format: "email" }),
  name: t.String(),
  kbId: t.Union([t.String(), t.Null()]),
});

const authResponseSchema = t.Object({
  token: t.String(),
  user: userSchema,
});

const signUpBody = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 8 }),
  name: t.String({ minLength: 1 }),
});

const signInBody = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 8 }),
});

export const authRoutes = new Elysia({ tags: ["Auth"] })
  .use(authContextPlugin)
  .post("/auth/signup", ({ body, request }) => authService.signUp(body, request.headers), {
    body: signUpBody,
    response: authResponseSchema,
    detail: {
      summary: "Create a FocusLayer account",
    },
  })
  .post("/auth/login", ({ body, request }) => authService.signIn(body, request.headers), {
    body: signInBody,
    response: authResponseSchema,
    detail: {
      summary: "Sign in with email and password",
    },
  })
  .get("/me", ({ currentUser }) => currentUser, {
    auth: true,
    response: userSchema,
    detail: {
      summary: "Get the authenticated user profile",
    },
  });