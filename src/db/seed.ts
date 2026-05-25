// Seed the achievement catalog (curated + generated) into Neon. Idempotent: re-running
// upserts names/desc/tier so catalog edits propagate. `bun run db:seed`.
import { sql } from "drizzle-orm";
import { CURATED, generatedCatalog } from "../core/achievements/index.ts";
import { db } from "./index.ts";
import { achievements } from "./schema.ts";

const seen = new Set<string>();
const rows: typeof achievements.$inferInsert[] = [];
const push = (a: { id: string; name: string; desc: string; cat: string; tier: string; vis: string }, generated: boolean) => {
  if (seen.has(a.id)) return; seen.add(a.id);
  rows.push({ id: a.id, name: a.name, description: a.desc, category: a.cat, tier: a.tier, visibility: a.vis, generated });
};
for (const a of CURATED) push(a, false);
for (const d of generatedCatalog()) push(d, true);

console.log(`seeding ${rows.length} achievements (${CURATED.length} curated + ${rows.length - CURATED.length} generated)…`);
const CH = 1000;
for (let i = 0; i < rows.length; i += CH) {
  await db.insert(achievements).values(rows.slice(i, i + CH)).onConflictDoUpdate({
    target: achievements.id,
    set: { name: sql`excluded.name`, description: sql`excluded.description`, category: sql`excluded.category`, tier: sql`excluded.tier`, visibility: sql`excluded.visibility`, generated: sql`excluded.generated` },
  });
  process.stdout.write(`\r  ${Math.min(i + CH, rows.length)}/${rows.length}`);
}
console.log("\n✓ catalog seeded");
