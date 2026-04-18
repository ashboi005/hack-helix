import { t } from "elysia";
import {
  createInsertSchema,
  createSelectSchema,
} from "drizzle-typebox";
import { spreads } from "./utils";
import { user, session, account, verification, apikey } from "./schema";

/**
 * Database validation models for Elysia routes
 * Generated from Drizzle schemas with TypeBox utility
 */
export const models = {
  insert: spreads(
    {
      user: createInsertSchema(user, {
        email: t.String({ format: "email" }),
      }),
      session: createInsertSchema(session),
      account: createInsertSchema(account),
      verification: createInsertSchema(verification),
      apikey: createInsertSchema(apikey),
    },
    "insert"
  ),
  select: spreads(
    {
      user: createSelectSchema(user, {
        email: t.String({ format: "email" }),
      }),
      session: createSelectSchema(session),
      account: createSelectSchema(account),
      verification: createSelectSchema(verification),
      apikey: createSelectSchema(apikey),
    },
    "select"
  ),
} as const;
