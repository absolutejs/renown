// Quick connectivity + schema check: `bun run db:check`
import { sql } from "./index.ts";

const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
console.log("✓ connected to Neon");
console.log("public tables:", tables.map((r: any) => r.table_name).join(", ") || "(none yet — run db:push)");
