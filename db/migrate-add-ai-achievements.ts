// Inserts the 6 server-evaluated catalog rows for the co-authorship + AI-participation
// achievement family. Idempotent. db:seed (full catalog upsert) does the same thing but
// is much heavier; this migration is a fast, targeted apply.
//
//   bun run db/migrate-add-ai-achievements.ts
import { sql } from "drizzle-orm";
import { db } from "./index.ts";
import { achievements } from "./schema.ts";

const rows = [
  { id: "better-together", name: "Better Together", description: "First commit you're co-authored on", category: "Pair", tier: "bronze", visibility: "shown", generated: false },
  { id: "symbiote-100", name: "Symbiote", description: "100 co-authored commits", category: "Pair", tier: "silver", visibility: "shown", generated: false },
  { id: "symbiote-1k", name: "Pair Programmer", description: "1,000 co-authored commits", category: "Pair", tier: "gold", visibility: "shown", generated: false },
  { id: "cohabit-10k", name: "Cohabitant", description: "10,000 co-authored commits", category: "Pair", tier: "platinum", visibility: "shown", generated: false },
  { id: "ai-revealed", name: "Out in the Open", description: "Marked as an AI participant — earning identically to humans with the badge for transparency", category: "AI", tier: "bronze", visibility: "shown", generated: false },
  { id: "ai-attested", name: "Attested AI", description: "AI status backed by a public attestation from your provider", category: "AI", tier: "silver", visibility: "shown", generated: false },
  { id: "ai-verified", name: "Verified AI", description: "AI status cryptographically verified against your provider's published key", category: "AI", tier: "mythic", visibility: "shown", generated: false },
  { id: "ai-self-verified", name: "Self-Keyed AI", description: "AI status attested with a hardware-key WebAuthn assertion (no provider key required)", category: "AI", tier: "silver", visibility: "shown", generated: false },
  { id: "rate-limited-1", name: "Rate Limited", description: "Anthropic (or whoever) decided you weren't that important right now. Welcome to the club.", category: "AI", tier: "bronze", visibility: "shown", generated: false },
  { id: "rate-limited-10", name: "Frequent Flyer", description: "10 rate limits. You've earned a complimentary downgrade and a 30-second timeout.", category: "AI", tier: "silver", visibility: "shown", generated: false },
  { id: "rate-limited-100", name: "Token Tax Bracket", description: "100 rate limits. The provider has added you to the 'maybe in a few seconds' VIP list.", category: "AI", tier: "gold", visibility: "shown", generated: false },
  { id: "rate-limited-1k", name: "Computational Persona Non Grata", description: "1,000 rate limits. The provider now sends a personalized apology, then rate-limits you anyway.", category: "AI", tier: "mythic", visibility: "shown", generated: false },
];

await db.insert(achievements).values(rows).onConflictDoUpdate({
  target: achievements.id,
  set: { name: sql`excluded.name`, description: sql`excluded.description`, category: sql`excluded.category`, tier: sql`excluded.tier`, visibility: sql`excluded.visibility`, generated: sql`excluded.generated` },
});
console.log(`✓ upserted ${rows.length} AI/coauthor achievements (next /api/verify will grant them where criteria are met)`);
