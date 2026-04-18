import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey } from "@better-auth/api-key";
import { openAPI } from "better-auth/plugins";
import { Resend } from "resend";
import { user, session, verification, account, apikey } from "../db/schema";
import { db } from "@/db";
import type { VerificationEmailPayload } from "@/types/auth";

const resend = new Resend(process.env.RESEND_API_KEY);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      verification,
      account,
      apikey,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  basePath: "/api/auth",
  trustedOrigins: [(process.env.FRONTEND_URL || "http://localhost:5173")],
  session: {
    // Keep users signed in with rolling sessions, but expire after 14 days.
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // ← Require email verification before sign-in
  },
  emailVerification: {
    sendVerificationEmail: async ({ user: verificationUser, url }: VerificationEmailPayload) => {
      try {
        console.log(`📧 Sending verification email to: ${verificationUser.email}`)
        
        const frontendVerifyUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${new URL(url).searchParams.get("token")}`

        const response = await resend.emails.send({
          from: "noreply@gaze.arunya.xyz", // Your domain
          to: verificationUser.email,
          subject: "Verify your GazeCore email",
          html: `
            <h2>Welcome to GazeCore!</h2>
            <p>Click the link below to verify your email and complete your sign up:</p>
            <a href="${frontendVerifyUrl}" style="display: inline-block; margin-top: 12px; padding: 10px 20px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px;">
              Verify Email
            </a>
            <p style="margin-top: 20px; color: #666; font-size: 12px;">
              This link expires in 24 hours. If you didn't sign up for GazeCore, you can safely ignore this email.
            </p>
          `,
        })

        if ("error" in response && response.error) {
          console.error(`❌ Resend API error: ${response.error.message}`)
          throw new Error(`Email sending failed: ${response.error.message}`)
        }

        console.log(`✅ Verification email sent successfully`)
      } catch (error) {
        console.error("❌ Failed to send verification email:", error)
        throw error
      }
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      accessType: "offline",
      prompt: "select_account consent",
    },
  },
  plugins: [
    openAPI({
      disableDefaultReference: true,
    }),
    apiKey({
      defaultPrefix: "gaze_",
      enableMetadata: true,
      startingCharactersConfig: {
        shouldStore: true,
        charactersLength: 9,
      },
      rateLimit: {
        enabled: true,
        maxRequests: 100,
        timeWindow: 1000 * 60 * 60,
      },
    }),
  ],
  experimental: {
    joins: true,
  },
});