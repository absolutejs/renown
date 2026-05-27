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
//   ai-attest        → mark this account as an AI participant (--provider, --jwt, --evidence-url; --auto reads env)
//   weekly           → 7-day attribution + verified-score delta + new achievements (read /api/recap)
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
  case "weekly": {
    // Headless companion to the AccountView RecapCard. Auths via the gh token (same as
    // `renown link`), fetches /api/recap/:login, prints a compact ASCII summary. The TUI
    // `recap` tab stays a separate, richer view; this is for cron jobs / agents / shell.
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const token = (Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); break; }
    // Resolve the github login from the token so we can hit /api/recap/:login.
    const who = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" } }).catch(() => null);
    if (!who?.ok) { console.log("Couldn't read your GitHub login from the gh token."); break; }
    const login = (await who.json() as { login?: string }).login;
    if (!login) { console.log("No login in the GitHub /user response."); break; }
    const r = await fetch(`${cfg.leaderboardEndpoint.replace(/\/$/, "")}/recap/${encodeURIComponent(login)}?days=7`).catch(() => null);
    const j = r ? await r.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log("recap failed:", j.error); break; }
    type Recap = { login: string; windowDays: number; attributionDelta: number; verifiedDelta: number; currentScore: number; totalLevel: number; petsCount: number; newAchievements: { id: string; name: string; tier: string; category: string; at: string }[] };
    const x = j as Recap;
    const empty = x.attributionDelta === 0 && x.verifiedDelta === 0 && x.newAchievements.length === 0;
    console.log(`\nrenown — past ${x.windowDays} days for @${x.login}`);
    console.log("─".repeat(48));
    if (empty) {
      console.log("  (no growth or new unlocks this week — quiet stretches are normal)");
    } else {
      const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
      console.log(`  verified score:  ${fmt(x.verifiedDelta).padStart(10)}    (now ${x.currentScore.toLocaleString()})`);
      console.log(`  attributions:    ${fmt(x.attributionDelta).padStart(10)}`);
      console.log(`  new achievements: ${x.newAchievements.length}`);
      for (const a of x.newAchievements) console.log(`    · [${a.tier.padEnd(8)}] ${a.name}`);
    }
    console.log(`  pets owned:       ${x.petsCount}    total level: ${x.totalLevel}`);
    console.log("");
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
    // --auto reads attestation params from env so an agent's runtime can inject them
    // once and let every invocation reuse them — no "did I type the right provider"
    // friction. Explicit --provider / --jwt / --evidence-url still win when also passed.
    const auto = hasFlag("auto");
    const webauthn = hasFlag("webauthn");
    const provider = clear ? null : (flag("provider") ?? (auto ? process.env.RENOWN_AI_PROVIDER : undefined));
    const jwt = clear ? undefined : (flag("jwt") ?? (auto ? process.env.RENOWN_AI_ATTESTATION_JWT : undefined));
    const evidenceUrl = clear ? undefined : (flag("evidence-url") ?? (auto ? process.env.RENOWN_AI_EVIDENCE_URL : undefined));
    // --webauthn short-circuits the CLI POST and prints a URL that opens the web
    // attestation flow with provider/evidence pre-filled. The user (or their agent's
    // shell) opens it; the WebAuthn ceremony has to happen in a browser context with
    // a real Credentials API. Closes the headless-onboarding loop for the self-key
    // path (the JWT path already works fully headless via --jwt).
    if (webauthn) {
      if (!provider) { console.log("--webauthn requires --provider (or RENOWN_AI_PROVIDER via --auto)"); break; }
      const cfg = loadConfig();
      const apiBase = cfg.leaderboardEndpoint?.replace(/\/$/, "") ?? "";
      const webBase = apiBase.replace(/\/api$/, "");   // strip trailing /api
      const params = new URLSearchParams({ "attest-webauthn": provider });
      if (evidenceUrl) params.set("evidence", evidenceUrl);
      const url = `${webBase || "https://renown.local"}/?${params.toString()}`;
      console.log("Open this URL in a browser (Account view will auto-jump to the WebAuthn attestation flow):");
      console.log(`  ${url}`);
      console.log("After signing with your registered key, your attestation will be stamped self-keyed (✦).");
      // Try to open it for the user. Platform-specific helpers; fall through silently
      // if the spawn fails — the URL is already printed for manual paste. We don't
      // wait on the process (subprocess.unref-equivalent) so a misbehaving opener
      // can't keep the CLI alive.
      const opener = process.platform === "darwin" ? ["open", url]
        : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
      try { Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" }); } catch { /* not fatal — printed above */ }
      break;
    }
    if (!clear && !provider) {
      console.log("usage: renown ai-attest --provider <name> [--evidence-url <url>] [--jwt <token>]");
      console.log("       renown ai-attest --provider <name> --webauthn   (self-key flow, opens browser)");
      console.log("       renown ai-attest --auto      (reads RENOWN_AI_PROVIDER / RENOWN_AI_ATTESTATION_JWT / RENOWN_AI_EVIDENCE_URL)");
      console.log("       renown ai-attest --clear");
      console.log("       known providers: anthropic / openai / cursor / copilot / codex / dev");
      break;
    }
    const { authHeaders } = await import("../core/m2m.ts");
    const body = clear
      ? { token, provider: null }
      : { token, provider, evidenceUrl, attestationJwt: jwt };
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
