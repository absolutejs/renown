// One-time privacy cleanup after migrate-add-project-visibility.ts.
//
// Classify every fail-closed legacy row against GitHub. Confirmed public repositories are
// retained; confirmed private or 404 (private to this token/deleted) repositories are purged.
// Transient/rate-limit failures abort the run and leave the remaining rows hidden as unknown.
import { sql } from "./index.ts";

const token = process.env.GITHUB_TOKEN;
const headers: Record<string, string> = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "renown-project-privacy-migration",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

const rows = await sql`select key from projects where visibility <> 'public' order by key` as { key: string }[];
let published = 0, purged = 0;
for (const row of rows) {
  const response = await fetch(`https://api.github.com/repos/${row.key}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    throw new Error(`GitHub classification stopped at ${row.key}: HTTP ${response.status}; remaining rows stay hidden`);
  }
  if (response.status === 404) {
    await sql.transaction([
      sql`delete from player_projects where project_key = ${row.key}`,
      sql`delete from projects where key = ${row.key}`,
    ]);
    purged++;
    continue;
  }
  if (!response.ok) throw new Error(`GitHub classification failed at ${row.key}: HTTP ${response.status}`);
  const repo = await response.json() as { private?: boolean };
  if (typeof repo.private !== "boolean") throw new Error(`GitHub classification returned no visibility for ${row.key}; row stays hidden`);
  if (repo.private) {
    await sql.transaction([
      sql`delete from player_projects where project_key = ${row.key}`,
      sql`delete from projects where key = ${row.key}`,
    ]);
    purged++;
  } else {
    await sql`update projects set visibility = 'public' where key = ${row.key}`;
    published++;
  }
}

console.log(`✓ project privacy cleanup: ${published} public classified, ${purged} non-public purged`);
