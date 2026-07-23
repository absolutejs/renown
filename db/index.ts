// Neon (serverless HTTP) + Drizzle client. DATABASE_URL comes from the environment
// (bun auto-loads .env). Neon's driver handles the sslmode/channel_binding params.
import { neon } from "@neondatabase/serverless";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

export const sql = neon(url);
export const relations = defineRelations(schema);
export const db = drizzle({ client: sql, relations });
export { schema };
