import { runMigrations } from "@absolutejs/auth";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const result = await runMigrations({ blocks: ["linkedProviders"], databaseUrl });
console.log(`linked-provider migrations: applied=${result.applied.length} skipped=${result.skipped.length}`);
