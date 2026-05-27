// Upsert the catalog rows for every merit ladder in web/src/backend/merit.ts.
// Idempotent; rerun whenever the MERIT registry changes (new ladder, new tier
// celebration text, threshold bump).
//
//   bun run db/migrate-add-merit-achievements.ts
import { sql } from "drizzle-orm";
import { meritAchievementRows, MERIT } from "../web/src/backend/merit.ts";
import { db } from "./index.ts";
import { achievements } from "./schema.ts";

const rows = meritAchievementRows();
await db.insert(achievements).values(rows).onConflictDoUpdate({
  target: achievements.id,
  set: { name: sql`excluded.name`, description: sql`excluded.description`, category: sql`excluded.category`, tier: sql`excluded.tier`, visibility: sql`excluded.visibility`, generated: sql`excluded.generated` },
});
console.log(`✓ upserted ${rows.length} merit achievement(s) across ${Object.keys(MERIT).length} ladder(s)`);
