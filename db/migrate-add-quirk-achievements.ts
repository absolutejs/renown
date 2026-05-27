// Upsert the catalog rows for every quirk in web/src/backend/quirks.ts. Idempotent;
// rerun whenever the registry changes (new quirks added or text rewritten).
//
//   bun run db/migrate-add-quirk-achievements.ts
import { sql } from "drizzle-orm";
import { quirkAchievementRows } from "../web/src/backend/quirks.ts";
import { db } from "./index.ts";
import { achievements } from "./schema.ts";

const rows = quirkAchievementRows();
await db.insert(achievements).values(rows).onConflictDoUpdate({
  target: achievements.id,
  set: { name: sql`excluded.name`, description: sql`excluded.description`, category: sql`excluded.category`, tier: sql`excluded.tier`, visibility: sql`excluded.visibility`, generated: sql`excluded.generated` },
});
console.log(`✓ upserted ${rows.length} quirk achievement(s) across ${new Set(rows.map((r) => r.id.replace(/-\d+k?$/, ""))).size} quirk(s)`);
