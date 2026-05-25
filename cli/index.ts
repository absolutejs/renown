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
//   summon [seed]     → procedurally generate & animate a unique creature ('gallery' = 6)
//   adopt [seed]      → adopt a wild find (default: your rarest) as your companion
//   companion         → watch your adopted companion (animated)
//   watch            → editor-agnostic activity daemon (next on the roadmap)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { HUD, WATCHED, loadState, renderGreet, renderHud, renderSkillList, saveState } from "../core/runtime.ts";
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
  case "summon": {
    const { generate, frames, renderCard } = await import("../core/procgen.ts");
    if (arg === "gallery") { for (let i = 0; i < 6; i++) console.log(renderCard(generate(`renown:${Date.now()}:${i}:${Math.random()}`)) + "\n"); }
    else { const cr = generate(arg ?? `renown:${Date.now()}:${Math.random()}`); const { play } = await import("../core/ascii.ts"); await play(frames(cr, 14), { delay: 120 }); console.log(renderCard(cr)); }
    break;
  }
  case "menagerie": { const { renderMenagerie } = await import("../core/procgen.ts"); console.log(renderMenagerie(loadState().wild ?? [])); break; }
  case "adopt": {
    const { generate } = await import("../core/procgen.ts");
    const st = loadState();
    let seed = arg;
    if (!seed) { if (!st.wild?.length) { console.log("No wild finds yet — they drop from real commits. (`renown summon` previews the generator.)"); break; } seed = [...st.wild].map(generate).sort((a, b) => b.score - a.score)[0].seed; }
    st.companion = seed; saveState(st);
    writeFileSync(HUD, renderHud(st));   // refresh the status line now so the companion shows immediately
    const cr = generate(seed);
    console.log(`✦ Adopted ${cr.name} (${cr.tier}) — it now lives in your status line. \`renown companion\` to see it.`);
    break;
  }
  case "companion": {
    const st = loadState();
    if (!st.companion) { console.log("No companion yet. `renown adopt` adopts your rarest wild find."); break; }
    const { generate, frames, renderCard } = await import("../core/procgen.ts");
    const cr = generate(st.companion); const { play } = await import("../core/ascii.ts");
    await play(frames(cr, 20), { delay: 130 }); console.log(renderCard(cr));
    break;
  }
  case "recap": { process.env.DQ_TAB = "5"; process.env.DQ_ONESHOT = "1"; const { runTui } = await import("./quest.ts"); await runTui(); break; }
  case "watch": { const { runDaemon } = await import("../core/daemon.ts"); await runDaemon(); break; }
  case undefined: case "": { const { runTui } = await import("./quest.ts"); await runTui(); break; }
  default: console.log("usage: renown [tick|commit <repo>|recap|heartbeat|greet|skills|collection|summon|menagerie|adopt|companion|parade|gallery|watch]");
}
