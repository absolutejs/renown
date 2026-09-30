import { readFileSync } from "node:fs";
import { sql } from "./index.ts";
import { SKILLS } from "../core/skills.ts";

// Install in one transaction; a failure cannot leave the guard half installed.
let statements = readFileSync(new URL("./progress-guard.sql", import.meta.url), "utf8")
  .replace("__SKILL_IDS__", JSON.stringify(SKILLS.map(s => s.id)).replaceAll("'", "''"));
// Incident repairs can protect just the explicitly authorized player. Omit for
// the normal application-wide migration after its deployment is approved.
const playerId = process.env.RENOWN_PROGRESS_PLAYER_ID;
if (playerId) statements = statements.replace("FOR EACH ROW EXECUTE", `FOR EACH ROW WHEN (OLD.id = '${playerId.replaceAll("'", "''")}') EXECUTE`);
await sql.transaction(statements.split("\n-- next\n").map(statement => sql.query(statement)));
console.log(`Renown progress guard installed for ${playerId ?? "all players"}.`);
