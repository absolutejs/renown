// Switches AI accounts' attribution_query from "author:<login>" to a co-author trailer
// search. The default `author:<login>` is right for human accounts (they author commits
// directly), but AI accounts almost never appear as the GitHub commit author — they
// appear in the `Co-authored-by:` trailer of a human's commit. Without this switch, an
// AI account's attribution count stays at zero forever.
//
// Resets last_attribution_sync_at to NULL so the next /api/verify backfills from
// createdAt with the new query, in one shot.
//
// New AI accounts that come up later should have their query set explicitly (admin
// or attestation flow); this migration only covers the currently-known AIs.
//
//   bun run db/migrate-ai-coauthor-query.ts
import { sql } from "./index.ts";

// Per-AI co-author trailer query. Quoted for GitHub's exact-phrase commit search. Add
// new rows here as new AI accounts come online (each AI provider may have a different
// trailer signature; keeping this explicit avoids guessing).
const AI_QUERIES: Record<string, string> = {
  claude: `"Co-authored-by: Claude"`,
};

for (const [login, query] of Object.entries(AI_QUERIES)) {
  const r = await sql`update players set attribution_query = ${query}, last_attribution_sync_at = null where github_login = ${login} and is_ai = true returning id` as { id: string }[];
  console.log(`  ${login}: ${r.length > 0 ? `updated (${r[0].id})` : "no matching AI account"}`);
}
console.log("✓ AI co-author queries set; next /api/verify will backfill from createdAt");
