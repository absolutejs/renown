// The AbsoluteJS PaaS runs this once per release, before the new web process
// takes traffic (absolute.hosting.json `release`), with the project's
// production variables. Each step is idempotent and runs in the order the
// droplet deploy ran them (until 2026-10-23); the first failure
// stops the release and the previous one keeps serving.
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..", "..");

const steps = [
  "db/migrate-add-project-visibility.ts",
  "db/migrate-add-attribution-ledger.ts",
  "web/scripts/migrate-linked-provider-grants.ts",
  "web/scripts/migrate-auth-sessions.ts",
  "db/migrate-reserved-ai-identities.ts",
  "db/purge-nonpublic-projects.ts",
  "db/seed.ts",
  "db/migrate-serialized-pets.ts",
  "db/migrate-marketplace.ts",
  "db/migrate-issuance-recovery.ts",
  "db/migrate-all-time-verified-score.ts",
  "db/migrate-preserve-progress.ts",
  "db/migrate-add-player-visits.ts",
];

for (const step of steps) {
  console.log(`release: ${step}`);
  const child = Bun.spawn([process.execPath, step], {
    cwd: repositoryRoot,
    stderr: "inherit",
    stdout: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    console.error(`release: ${step} exited with ${code}`);
    process.exit(code);
  }
}
