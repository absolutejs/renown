#!/usr/bin/env bun
// Renown CLI.  renown [tick | commit <repo> | recap | heartbeat | watch]
//   (no args)        → interactive TUI
//   tick             → engine heartbeat (score new work, stats, achievements, submit)
//   commit <repo>    → fast reconcile of one repo
//   recap            → one-shot Recap view
//   heartbeat        → register cwd's repo + tick (the entry editors/agents call)
//   greet            → one-line "welcome back" (streak + level), for session start
//   skills           → full skill sheet (all disciplines, levels + xp)
//   parade           → queue a sample celebration parade onto the status line
//   gallery          → full-screen animated ASCII showcase (big text, fireworks, rainbow)
//   collection       → your collectibles (drops + event loot)
//   watch            → editor-agnostic activity daemon (next on the roadmap)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { WATCHED, loadState, renderGreet, renderSkillList } from "../core/runtime.ts";
import { runEvent } from "../core/event.ts";

function registerCwdRepo() {
  try {
    const top = (Bun.spawnSync(["git", "-C", process.cwd(), "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!top) return;
    const cur = existsSync(WATCHED) ? readFileSync(WATCHED, "utf8").split("\n") : [];
    if (!cur.includes(top)) appendFileSync(WATCHED, top + "\n");
  } catch {}
}

const [, , cmd, arg] = process.argv;
switch (cmd) {
  case "tick": await runEvent("tick"); break;
  case "commit": await runEvent("commit", arg); break;
  case "heartbeat": registerCwdRepo(); await runEvent("tick"); break;
  case "greet": console.log(renderGreet(loadState())); break;
  case "skills": console.log(renderSkillList(loadState())); break;
  case "parade": {
    const { enqueue, skillUp, achievementUp, totalUp, bossUp } = await import("../core/celebrate.ts");
    enqueue([skillUp("🐍", "Python", 10), bossUp(), achievementUp("First Blood"), skillUp("🦀", "Rust", 50), achievementUp("Hidden Gem", 3), totalUp(200), skillUp("🚢", "Shipping", 99)]);
    console.log("✦ celebration parade queued — watch your status line");
    break;
  }
  case "gallery": { const { runGallery } = await import("../core/ascii.ts"); await runGallery(); break; }
  case "collection": { const { renderCollection } = await import("../core/collectibles.ts"); console.log(renderCollection(loadState().collectibles ?? {})); break; }
  case "recap": { process.env.DQ_TAB = "5"; process.env.DQ_ONESHOT = "1"; const { runTui } = await import("./quest.ts"); await runTui(); break; }
  case "watch": { const { runDaemon } = await import("../core/daemon.ts"); await runDaemon(); break; }
  case undefined: case "": { const { runTui } = await import("./quest.ts"); await runTui(); break; }
  default: console.log("usage: renown [tick | commit <repo> | recap | heartbeat | greet | skills | collection | parade | gallery | watch]");
}
