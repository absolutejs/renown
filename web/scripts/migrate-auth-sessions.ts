import { runMigrations } from "@absolutejs/auth";

// @absolutejs/auth's session store reads and writes columns its own migrations add
// (oauth_subject_json, sign_in_method, user_agent). The tables already exist from
// renown's schema; every step here is CREATE ... IF NOT EXISTS or ADD COLUMN IF NOT
// EXISTS, so it only fills in what an older auth release did not need.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const result = await runMigrations({ blocks: ["sessions"], databaseUrl });
console.log(`auth session migrations: applied=${result.applied.length} skipped=${result.skipped.length}`);
