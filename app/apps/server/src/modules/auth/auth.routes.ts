import { Elysia } from "elysia";
import { z } from "zod";

import { authContextPlugin } from "./auth.service";
import { authService } from "./auth.service";

const signUpBody = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const signInBody = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const authRoutes = new Elysia({ tags: ["Auth"] })
  .use(authContextPlugin)
  .post("/auth/signup", ({ body, request }) => authService.signUp(body, request.headers), {
    body: signUpBody,
    detail: {
      summary: "Create a FocusLayer account",
    },
  })
  .post("/auth/login", ({ body, request }) => authService.signIn(body, request.headers), {
    body: signInBody,
    detail: {
      summary: "Sign in with email and password",
    },
  })
  .get("/me", ({ currentUser }) => currentUser, {
    auth: true,
    detail: {
      summary: "Get the authenticated user profile",
    },
  });