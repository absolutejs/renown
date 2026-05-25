// Renown-specific post-restore step: recompute achievement rarity (unlock_count)
// from the restored unlocks. Run after `absolute db restore`. Idempotent + exact.
//   bun run db/recompute-rarity.ts
import { sql } from "./index.ts";

await sql`update achievements set unlock_count = (select count(*)::int from player_achievements pa where pa.achievement_id = achievements.id)`;
console.log("✓ recomputed achievement rarity (unlock_count)");
