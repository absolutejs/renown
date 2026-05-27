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
//   link             → link this install to your GitHub identity (browserless, via gh auth token)
//   ai-attest        → mark this account as an AI participant (--provider, --jwt, --evidence-url)
//   adopt [seed]      → adopt a wild find (default: your rarest) as your companion
//   companion         → watch your adopted companion (animated)
//   watch            → editor-agnostic activity daemon (next on the roadmap)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { HUD, WATCHED, loadConfig, loadState, renderGreet, renderHud, renderSkillList, saveState } from "../core/runtime.ts";
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
  case "sync": {
    // Force an immediate /submit so the web matches what your terminal shows. The tick already
    // does this on a timer; `sync` is the manual button when something feels out of date.
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const { submit } = await import("../core/leaderboard.ts");
    await submit(loadState(), cfg);
    console.log("✓ Pushed your local state to the web. Reload the Account page to see it.");
    break;
  }
  case "link": {
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const token = (Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!token) { console.log("No GitHub token — run `gh auth login` first, then `renown link`."); break; }
    const { authHeaders } = await import("../core/m2m.ts");   // also present a trusted-client token iff configured
    const res = await fetch(`${cfg.leaderboardEndpoint.replace(/\/$/, "")}/cli/link`, { method: "POST", headers: { "content-type": "application/json", ...(await authHeaders(cfg)) }, body: JSON.stringify({ playerId: cfg.playerId, token }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.ok) console.log(`✓ Linked to GitHub @${j.login} — verified score ${j.verifiedScore}. Your progress is now on the real leaderboard.`);
    else console.log("link failed:", j.error);
    break;
  }
  case "ai-attest": {
    // Headless AI attestation. Pairs with the web UI's AiAttestationCard but suitable
    // for fully-autonomous agents: claim, optionally provide signed JWT, or clear.
    //   renown ai-attest --provider anthropic [--evidence-url https://…] [--jwt <jwt>]
    //   renown ai-attest --clear
    // Auth via gh token (same as `renown link`). Server runs the same applyAttestation
    // helper as the web endpoint — identical state transitions and audit log writes.
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const args = process.argv.slice(3);
    const flag = (name: string): string | undefined => {
      const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
      if (i < 0) return undefined;
      if (args[i].includes("=")) return args[i].split("=", 2)[1];
      return args[i + 1];
    };
    const hasFlag = (name: string) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    const token = (Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!token) { console.log("No GitHub token — run `gh auth login` first, then re-try."); break; }
    const clear = hasFlag("clear");
    const provider = clear ? null : flag("provider");
    if (!clear && !provider) {
      console.log("usage: renown ai-attest --provider <name> [--evidence-url <url>] [--jwt <token>]");
      console.log("       renown ai-attest --clear");
      console.log("       known providers: anthropic / openai / cursor / copilot / codex / dev");
      break;
    }
    const { authHeaders } = await import("../core/m2m.ts");
    const body = clear
      ? { token, provider: null }
      : { token, provider, evidenceUrl: flag("evidence-url"), attestationJwt: flag("jwt") };
    const res = await fetch(`${cfg.leaderboardEndpoint.replace(/\/$/, "")}/cli/ai-attest`, { method: "POST", headers: { "content-type": "application/json", ...(await authHeaders(cfg)) }, body: JSON.stringify(body) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log("ai-attest failed:", j.error); break; }
    if (j.cleared) console.log("✓ Attestation cleared. is_ai → false, attribution_query restored to author:<login>.");
    else console.log(`✓ Attested as ${j.provider}${j.verified ? " (cryptographically verified ✓)" : ""}${j.resolvedKnownProvider ? " — attribution_query auto-filled" : " (unknown provider, query unchanged)"}`);
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
  default: console.log("usage: renown [tick|sync|commit <repo>|recap|heartbeat|greet|skills|collection|summon|menagerie|adopt|companion|parade|gallery|link|watch]");
}
