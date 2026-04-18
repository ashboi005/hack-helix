import { env } from "@app/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import { schema } from "./schema/index";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();
