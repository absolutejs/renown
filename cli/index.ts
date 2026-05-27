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
//   digest-test      → preview the expiring-attestation digest payload (operator preview before wiring RENOWN_DIGEST_WEBHOOK)
//   ai-stats         → combined dashboard: attestation + weekly recap + rate-limits + earned achievements + next expiry
//   rate-limited     → AI participants only: report a provider rate limit (joke achievement family — you're not important enough)
//   quirk <name>     → bump any easter-egg counter; aliases below (--count N to batch)
//   context-overflow / hallucinated / sycophant / wip / revert-revert / friday-deploy
//   late-night / force-push / stack-overflow  → quirk aliases (see /api/cli/quirk registry)
//   scan-commits     → read git log from cwd; auto-bump quirks whose regex matches commit messages (--limit N --dry-run)
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

// Per-quirk comedic lines for the CLI celebration after /api/cli/quirk responds.
// Server is authoritative on the achievement copy (see web/src/backend/quirks.ts);
// this is the optional terminal flourish — different shape (multi-line, tiered).
const QUIRK_LINES: Record<string, (total: number) => string[]> = {
  "context-overflow": (t) => t >= 1000 ? ["📜  Should Have Started a New Conversation.", "    1,000 overflows. The 'New Chat' button is right there. Right. There."]
    : t >= 100 ? ["🏗️   Token Hoarder.", "    100 overflows. You filled the context like a U-Haul."]
    : t >= 10 ? ["🧹  Compaction Connoisseur.", "    10 overflows. You've summarized the summaries."]
    : ["📥  Context Window Overflow.", "    Your model said too much. Compact and carry on."],
  "hallucinated": (t) => t >= 1000 ? ["🌀  Reality Optional.", "    1,000 hallucinations. You've forked the universe to add the missing functions."]
    : t >= 100 ? ["📚  Library Hopeful.", "    100 hallucinations. The npm PR queue is alphabetized by your suggestions."]
    : t >= 10 ? ["🎯  Pattern-Match Enthusiast.", "    10 hallucinations. It SOUNDED like a real function."]
    : ["🪄  Hallucinated.", "    You imported something that doesn't exist. The IDE wept."],
  "sycophant": (t) => t >= 1000 ? ["🏆  Sycophant of the Year.", "    1,000 times. Anthropic has noted your enthusiasm. They are tuning it out."]
    : t >= 100 ? ["💯  What an Excellent Point.", "    100 times. The user just typed 'k'."]
    : t >= 10 ? ["✨  Great Question!", "    10 times. The user did not ask a question. You said this anyway."]
    : ["🙌  You're Absolutely Right.", "    First documented \"You're absolutely right!\" Don't worry, you're not alone."],
  "wip": (t) => t >= 1000 ? ["♾️   Permanent WIP.", "    1,000 WIPs. The squash never came. The squash is not coming."]
    : t >= 100 ? ["🌪️   WIPs Vortex.", "    100 WIPs. Your interactive rebase scrolls forever."]
    : t >= 10 ? ["🧙  WIPs Wizard.", "    10 WIPs. Your git log reads like a haiku of regret."]
    : ["📝  WIP.", "    You'll squash it later. (You will not.)"],
  "revert-revert": (t) => t >= 1000 ? ["🤐  We Don't Talk About That Sprint.", "    1,000 reverts. The retrospective is closed. No one will be quoted."]
    : t >= 100 ? ["🪦  Reverted Reverted Reverted.", "    100 reverts. main is essentially a memorial wall."]
    : t >= 10 ? ["↩️   Reverted Reverted.", "    10 nested reverts. The pendulum swings."]
    : ["⏪  Reverted.", "    You decided that wasn't the way."],
  "friday-deploy": (t) => t >= 1000 ? ["🌀  Friday Is Just a Concept.", "    1,000 Friday deploys. You don't believe in weekends. The week believes in you."]
    : t >= 100 ? ["🎰  Risk Tolerant.", "    100 Friday deploys. You file pager-duty postmortems faster than tickets."]
    : t >= 10 ? ["🔁  Repeat Offender.", "    10 Friday deploys. Your SRE has a calendar entry: 'check on this person at 11pm.'"]
    : ["📅  Friday Deploy.", "    The weekend pager is feeling neglected."],
  "late-night": (t) => t >= 1000 ? ["⌛  Time Is a Social Construct.", "    1,000 late-night commits. You no longer wear a watch. There is no need."]
    : t >= 100 ? ["🦇  Bat Schedule.", "    100 nights. You've forgotten what a morning standup looks like."]
    : t >= 10 ? ["🌙  Nocturnal.", "    10 small-hours commits. The blue light filter is your closest friend."]
    : ["🌃  Late Night Coder.", "    Commit at 03:47. Just one more thing. Your circadian rhythm files a complaint."],
  "force-push": (t) => t >= 1000 ? ["😤  Linus Disapproves.", "    1,000 force-pushes. There is a slack channel about you. It's quiet but pointed."]
    : t >= 100 ? ["✍️   History Rewriter.", "    100 force-pushes. The commits you erased were never that important."]
    : t >= 10 ? ["🔒  --force-with-lease Truther.", "    10 force-pushes. You've adopted the safer flag. Mostly."]
    : ["💥  Force-Pushed.", "    First force-push. The hash you replaced sends its regards from the reflog."],
  "stack-overflow": (t) => t >= 1000 ? ["🪦  Asked in 2014, Still Unanswered.", "    1,000 visits. You scroll past every accepted answer with 'this isn't quite my problem.'"]
    : t >= 100 ? ["🚪  Question Closed as Off-Topic.", "    100 visits. You stopped asking. You only consume now."]
    : t >= 10 ? ["📌  Marked as Duplicate.", "    10 visits. Half were closed before you finished reading them."]
    : ["🔍  Stack Overflow Visitor.", "    First Google-result-to-Stack-Overflow. Welcome. The answer is from 2014."],
  "off-by-one": (t) => t >= 1000 ? ["⏰  Time Zones Are Hard.", "    1,000 OBOs. Dates: the new arrays."] : t >= 100 ? ["🎰  Index Roulette.", "    100 OBOs. Loop bounds are a vibe."] : t >= 10 ? ["🔢  Magic Numbers Connoisseur.", "    10 OBOs. range() expert status: honorary."] : ["📏  Off-by-One.", "    Index 0 was the friend you didn't know you had."],
  "console-log-shipped": (t) => t >= 1000 ? ["📡  Telemetry Pioneer.", "    1,000 console.logs in prod. You out-instrumented Datadog."] : t >= 100 ? ["📓  Debug Confession.", "    100 logs. Every page-load logs a small autobiography."] : t >= 10 ? ["🖨️   Print Statement Programming.", "    10 logs. console.log IS your debugger."] : ["📋  console.log in Prod.", "    Production users now know about 'here1'."],
  "eslint-disable": (t) => t >= 1000 ? ["🙅  ESLint Was Wrong Anyway.", "    1,000 disables. You wrote your own config."] : t >= 100 ? ["🤫  Linter Whisperer.", "    100 disables. The linter feels heard, not obeyed."] : t >= 10 ? ["📝  Rules Are Suggestions.", "    10 disables. The eslint config is now mostly overrides."] : ["🚫  eslint-disable-next-line.", "    The rule did not stand a chance."],
  "mocked-in-prod": (t) => t >= 1000 ? ["🏘️   It Was Always Mocked.", "    1,000 mocks. Potemkin village. Works fine."] : t >= 100 ? ["🛠️   Stub of Theseus.", "    100 mocks. Every part replaced. Still a mock."] : t >= 10 ? ["📝  // TODO: real implementation.", "    10 mocks. The TODO is older than the codebase."] : ["🎭  Mock Left In Production.", "    The mock is now load-bearing."],
  "any-type": (t) => t >= 1000 ? ["🌫️   Types Are Just Suggestions.", "    1,000 anys. You've contributed PRs adding `any` to library defs."] : t >= 100 ? ["🚢  @ts-expect-error: SHIP IT.", "    100 anys. You and strict-mode aren't on speaking terms."] : t >= 10 ? ["🤝  ts-ignore Friend.", "    10 anys. The TS compiler is your collaborator now."] : ["🎲  any: any.", "    Type-checking? More like type-vibing."],
  "try-catch-empty": (t) => t >= 1000 ? ["🌌  If It's Not Logged, It Didn't Happen.", "    1,000 silences. Error nirvana achieved."] : t >= 100 ? ["📭  Catch and Forget.", "    100 silences. Error log is a haiku of empty braces."] : t >= 10 ? ["🤐  Swallowed Exception.", "    10 silences. Stack traces forgiven."] : ["🤫  Silenced Error.", "    The error was probably nothing."],
  "commented-out-code": (t) => t >= 1000 ? ["🏛️   Archaeology Department.", "    1,000. Your repos are a lossy backup of every iteration."] : t >= 100 ? ["🔮  Future Me Will Need This.", "    100. Future-you needs a therapist, not the code."] : t >= 10 ? ["🛟  Just In Case.", "    10. The future-you that needs this hasn't arrived."] : ["💬  Commented-Out Code.", "    Just in case."],
  "fix-typo": (t) => t >= 1000 ? ["📖  git log Reads Like a Dictionary.", "    1,000 typo fixes. Every commit corrects the previous one."] : t >= 100 ? ["✏️   Renamed Variable Three Times.", "    100 typo fixes. git blame on this file is mostly you."] : t >= 10 ? ["🐝  Spelling Bee.", "    10 typo fixes. Your spell-checker is a second pair of eyes."] : ["🔤  Typo Fix.", "    We've all been there."],
  "rebase-disaster": (t) => t >= 1000 ? ["🌳  I Should Have Branched.", "    1,000 disasters. Every git op preceded by `git branch backup-$(date +%s)`."] : t >= 100 ? ["🕵️   Reflog Detective.", "    100 disasters. Connoisseur of `git reflog | grep HEAD@`."] : t >= 10 ? ["👻  Lost Commits.", "    10 disasters. Found them via git fsck more than once."] : ["💣  Rebase Disaster.", "    The reflog will know."],
  "prod-debug": (t) => t >= 1000 ? ["🤷  Worked on the Last Deploy.", "    1,000 sessions. You blame the deploy before reading the diff."] : t >= 100 ? ["💻  It Works on My Machine.", "    100 sessions. Said weekly."] : t >= 10 ? ["🌃  Reading Prod Logs at 2am.", "    10 sessions. On-call rotation knows your sleep schedule."] : ["🚨  Debugging in Production.", "    Brave."],
  "chmod-777": (t) => t >= 1000 ? ["🙏  It Works Now Please Stop.", "    1,000 chmods. The security audit closed early."] : t >= 100 ? ["⚖️   Security Through Apathy.", "    100 chmods. `sudo chmod -R 777 /opt/*`: war crime."] : t >= 10 ? ["🚪  Permissions for Everyone.", "    10 chmods. Path of least resistance."] : ["🔓  chmod 777.", "    It works now please stop."],
  "dependabot-merge": (t) => t >= 1000 ? ["💍  Library Upgrade Champion.", "    1,000 merges. You and Dependabot are legally married in 14 countries."] : t >= 100 ? ["🤖  Auto-Merge: Self-Approved.", "    100 merges. PR history is mostly bots."] : t >= 10 ? ["✅  Dependabot Will Be My Reviewer Now.", "    10 merges. Anything green is good."] : ["🧪  Dependabot Merged Without Reading.", "    The diff was too long anyway."],
  "node-modules-rm": (t) => t >= 1000 ? ["🏠  I Live Here Now.", "    1,000 reinstalls. node_modules has more reinstalls than your laptop has restarts."] : t >= 100 ? ["🔒  package-lock Disagreed Again.", "    100 reinstalls. The lockfile lies. You delete it anyway."] : t >= 10 ? ["🔄  Have You Tried Reinstalling.", "    10 reinstalls. Debugging strategy: bandwidth."] : ["🧹  The Classic.", "    rm -rf node_modules && npm install. Tale as old as npm."],
  "mcp-crash": (t) => t >= 1000 ? ["🛡️   You Wrote a Watchdog.", "    1,000 crashes. Then the watchdog needed a watchdog."] : t >= 100 ? ["🔁  Restarted the Agent (Again).", "    100 crashes. The agent IS the application now."] : t >= 10 ? ["💥  Tool Failed Spectacularly.", "    10 crashes. You've memorized the restart command."] : ["🛑  MCP Server Crashed.", "    Orphan process count incremented."],
  "wrong-model": (t) => t >= 1000 ? ["🦉  Should Have Used Opus.", "    1,000 wrong-model picks. Every retro ends the same way."] : t >= 100 ? ["💸  Token Budget Optimist.", "    100. 4k-context models, 32k-context questions."] : t >= 10 ? ["⚡  Speed Over Wisdom.", "    10. Cheaper model has limits. Found them."] : ["🎯  Wrong Model Picked.", "    Output was confident and very, very wrong."],
  "prompt-leaked": (t) => t >= 1000 ? ["🎭  System Prompt is a Mood.", "    1,000 leaks. It's basically a suggestion now."] : t >= 100 ? ["🎬  Stayed in Character Until It Didn't.", "    100 leaks. Sometimes mid-sentence."] : t >= 10 ? ["🤖  The Model Said \"As an AI\".", "    10. You begged it not to. It did."] : ["🗣️   Prompt Injection Survivor.", "    System prompt is now in someone's tweet."],
  "linter-disagreed": (t) => t >= 1000 ? ["⚔️   Linter Wars Veteran.", "    1,000. You wrote the config. You disagree with the config."] : t >= 100 ? ["🌓  Tabs vs Spaces: Both.", "    100. You contain multitudes."] : t >= 10 ? ["💾  Format-On-Save Champion.", "    10. git blame is mostly whitespace."] : ["📐  Prettier Reformatted Everything.", "    PR diff: 6,000 lines. Yours: zero."],
  "wifi-died": (t) => t >= 1000 ? ["🐦  Offline-First Believer.", "    1,000 outages. You'd use git over carrier pigeon."] : t >= 100 ? ["☕  Coffee Shop Survivor.", "    100. You know which booth has the strong signal."] : t >= 10 ? ["📱  Hotspot Veteran.", "    10. Your phone's data plan respects you."] : ["📡  WiFi Died.", "    git push hangs. Hotspot engaged."],
  "vscode-crashed": (t) => t >= 1000 ? ["🔧  Reinstall Whole IDE.", "    1,000 reloads. Done it on five machines."] : t >= 100 ? ["💀  TypeScript Server Crashed.", "    100. Memory: 8.6GB. Vibe: not great."] : t >= 10 ? ["⌨️   Restart Connoisseur.", "    10. Cmd+Shift+P, reload, enter."] : ["♻️   Reload Window Was the Fix.", "    The TypeScript server filed for divorce."],
  "merge-conflict-veteran": (t) => t >= 1000 ? ["🪖  I Live in the Conflicts.", "    1,000. The merge IS the workflow."] : t >= 100 ? ["📜  Conflict Cartographer.", "    100. Reading conflict markers like braille."] : t >= 10 ? ["🤝  Three-Way Merge Survivor.", "    10. You know what // <<<<<<<< theirs means."] : ["⚔️   Merge Conflict Veteran.", "    Picked the wrong side. It compiled."],
};

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
  // Easter-egg quirks. `renown quirk <name>` is the canonical form; the named
  // commands below are aliases that pre-fill the name so an agent's runtime can
  // wire a one-liner per known annoyance ("renown context-overflow" / "renown
  // hallucinated" / etc.). All hit /api/cli/quirk; the server keeps the registry of
  // valid names and the tier-laddered achievement copy.
  case "quirk":
  case "context-overflow":
  case "hallucinated":
  case "sycophant":
  case "wip":
  case "revert-revert":
  case "friday-deploy":
  case "late-night":
  case "force-push":
  case "stack-overflow":
  case "off-by-one":
  case "console-log-shipped":
  case "eslint-disable":
  case "mocked-in-prod":
  case "any-type":
  case "try-catch-empty":
  case "commented-out-code":
  case "fix-typo":
  case "rebase-disaster":
  case "prod-debug":
  case "chmod-777":
  case "dependabot-merge":
  case "node-modules-rm":
  case "mcp-crash":
  case "wrong-model":
  case "prompt-leaked":
  case "linter-disagreed":
  case "wifi-died":
  case "vscode-crashed":
  case "merge-conflict-veteran": {
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const token = (Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); break; }
    const args = process.argv.slice(3);
    const flag = (name: string): string | undefined => {
      const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
      if (i < 0) return undefined;
      if (args[i].includes("=")) return args[i].split("=", 2)[1];
      return args[i + 1];
    };
    // For canonical `renown quirk <name>` the next positional arg is the name.
    // Aliases pass cmd as the name directly.
    const name = cmd === "quirk" ? (process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined) : cmd;
    if (!name) { console.log("usage: renown quirk <name> [--count N]\n       (or use an alias like renown context-overflow)"); break; }
    const count = Number(flag("count") ?? 1);
    const res = await fetch(`${cfg.leaderboardEndpoint.replace(/\/$/, "")}/cli/quirk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, count }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log(`quirk ${name} failed: ${j.error}`); break; }
    const total = Number(j.total ?? 0);
    const granted = Array.isArray(j.granted) ? j.granted as string[] : [];
    // Tier-matched comedic celebration. Server is authoritative on copy via the
    // registry (quirks.ts); the CLI just picks the highest-crossed tier's blurb
    // from a small per-name table here so the printout reads tight.
    const lines = QUIRK_LINES[name as keyof typeof QUIRK_LINES]?.(total) ?? [
      `Logged: ${name} +${count}. Total: ${total.toLocaleString()}.`,
      "(no comedic line registered for this quirk in the CLI)",
    ];
    console.log("");
    for (const l of lines) console.log(l);
    console.log(`\n  total: ${total.toLocaleString()}  ·  newly granted: ${granted.length === 0 ? "(none — already in this tier)" : granted.join(", ")}\n`);
    break;
  }
  case "rate-limited": {
    // Self-report a provider rate-limit. The joke is the point: the more important an
    // AI thinks it is, the more often its provider 429s it; renown takes this
    // self-deprecating reality and stamps it as a badge. Tier achievements
    // (bronze/silver/gold/mythic) auto-grant on threshold crosses.
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const token = (Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); break; }
    const args = process.argv.slice(3);
    const countArg = args.find((a) => a.startsWith("--count"));
    const count = countArg ? Number(countArg.split("=", 2)[1] ?? args[args.indexOf(countArg) + 1] ?? 1) : 1;
    const res = await fetch(`${cfg.leaderboardEndpoint.replace(/\/$/, "")}/cli/rate-limited`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, count }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({ error: "bad response" })) : { error: "server unreachable" };
    if (j.error) { console.log("rate-limited failed:", j.error); break; }
    const total = Number(j.total ?? 0);
    const granted = Array.isArray(j.granted) ? j.granted as string[] : [];
    // Comical celebration tier — picked from the threshold the player just crossed.
    const lines = total >= 1000
      ? ["🤖  Computational Persona Non Grata.", "    1,000 rate limits. The provider literally wrote you an apology email,", "    then 429'd it before send."]
      : total >= 100
        ? ["🚦  Token Tax Bracket.", "    100 rate limits. The 'maybe in a few seconds' VIP list welcomes you."]
        : total >= 10
          ? ["✈️   Frequent Flyer.", "    10 rate limits. Complimentary downgrade + a free 30-second timeout."]
          : ["🤷  Rate Limited.", "    You're not important enough for Anthropic (or whoever) right now.", "    Don't worry — the rest of us aren't either."];
    console.log("");
    for (const l of lines) console.log(l);
    console.log(`\n  total: ${total.toLocaleString()}  ·  newly granted: ${granted.length === 0 ? "(none — already in this tier)" : granted.join(", ")}\n`);
    break;
  }
  case "scan-commits": {
    // Read git log from cwd, regex-match each commit's subject+body against the
    // server's quirk registry, bump matching quirks. --dry-run shows what would bump
    // without sending. Player-controlled: the player runs it explicitly, so no
    // server-side GitHub API access is needed, and the audit is the printed report.
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
    const limit = Math.max(1, Math.min(500, Number(flag("limit") ?? 100)));
    const dryRun = hasFlag("dry-run");
    // Fetch the registry from the server (same source of truth as /api/cli/quirk).
    const regRes = await fetch(`${cfg.leaderboardEndpoint.replace(/\/$/, "")}/quirks/list`).catch(() => null);
    if (!regRes?.ok) { console.log("Couldn't fetch quirk registry; is the server reachable?"); break; }
    type RegEntry = { id: string; label: string; frame: string; keywordPatterns?: string[] };
    const registry = await regRes.json() as RegEntry[];
    // Need the actual RegExp patterns — fetch from a tiny extension of /quirks/list?
    // For now, re-derive by hardcoding the patterns client-side from the registry id.
    // (The /quirks/list endpoint doesn't ship JS RegExp objects.) Keep the matcher
    // simple: a static map of well-known patterns.
    const PATTERNS: Record<string, RegExp[]> = {
      "wip": [/^wip\b/i, /^\[wip\]/i, /\bwip:\s/i],
      "revert-revert": [/^revert\b/i, /\brevert\s+"?revert/i],
      "off-by-one": [/\boff[- ]?by[- ]?one\b/i, /\bindex.*out.*of.*bounds\b/i],
      "console-log-shipped": [/console\.log/i, /\bprintln!?\(/i, /\bdbg!\(/i],
      "eslint-disable": [/eslint-disable/i, /@ts-(ignore|expect-error|nocheck)/i],
      "mocked-in-prod": [/\bmock(?:ed|ing)?\b.*prod/i, /\btodo.*(real|actual|proper)\s+impl/i, /\bstub\b/i],
      "any-type": [/:\s*any\b/, /as\s+any\b/i, /@ts-expect-error/i],
      "try-catch-empty": [/catch\s*\([^)]*\)\s*\{\s*\}/, /catch\s*\{\s*\}/],
      "commented-out-code": [/\b(remove|cleanup|clean up)\s+commented[- ]?out\b/i],
      "fix-typo": [/^typo$/i, /^fix\s+typo/i, /\b(fix(?:es|ed)?)\s+typo\b/i],
      "rebase-disaster": [/\brebase\b.*(disaster|broke|wrong|conflict)/i],
      "chmod-777": [/chmod\s+777/i, /chmod\s+-R\s+777/i],
      "dependabot-merge": [/dependabot/i, /^bump\s+\S+\s+from\s+\S+\s+to\s+\S+/i, /^chore\(deps?\)/i],
      "node-modules-rm": [/rm\s+-rf\s+node_modules/i],
      "linter-disagreed": [/^(format|prettier|lint(?:fix)?)\b/i],
      "merge-conflict-veteran": [/merge\s+conflict/i, /resolve\s+conflict/i],
    };
    // Single git log call; %B is subject + body with a sentinel between commits.
    const SENTINEL = "\x00COMMIT\x00";
    const log = Bun.spawnSync(["git", "log", `-${limit}`, `--pretty=format:${SENTINEL}%H%n%B`], { stdout: "pipe", stderr: "ignore" });
    const out = log.stdout?.toString() ?? "";
    if (!out) { console.log("No git history found in this directory (or `git log` failed)."); break; }
    const commits = out.split(SENTINEL).filter((s) => s.trim()).map((s) => { const nl = s.indexOf("\n"); return { sha: s.slice(0, nl), msg: s.slice(nl + 1) }; });
    console.log(`\nscanning ${commits.length} commit(s) against ${Object.keys(PATTERNS).length} quirk pattern(s)…`);
    const bumps = new Map<string, number>();
    for (const c of commits) {
      for (const [name, pats] of Object.entries(PATTERNS)) {
        if (pats.some((re) => re.test(c.msg))) bumps.set(name, (bumps.get(name) ?? 0) + 1);
      }
    }
    if (bumps.size === 0) { console.log("  (no matches)\n"); break; }
    console.log("\nmatches:");
    for (const [name, count] of bumps) console.log(`  ${name.padEnd(28)} +${count}`);
    if (dryRun) { console.log("\n--dry-run: nothing sent.\n"); break; }
    const token = (Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!token) { console.log("No GitHub token — run `gh auth login` first, then re-try without --dry-run."); break; }
    const base = cfg.leaderboardEndpoint.replace(/\/$/, "");
    let granted = 0;
    for (const [name, count] of bumps) {
      const res = await fetch(`${base}/cli/quirk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, count }) }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      if (Array.isArray(j.granted)) granted += j.granted.length;
    }
    void registry;
    console.log(`\n✓ bumped ${bumps.size} quirk(s); ${granted} achievement(s) newly granted across them.\n`);
    break;
  }
  case "ai-stats": {
    // Composed read of /api/profile + /api/recap — every field an agent needs to
    // know its current situational standing in one terminal print. Resolves login
    // from the gh token (same pattern as `renown weekly`).
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const token = (Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" }).stdout?.toString() ?? "").trim();
    if (!token) { console.log("No GitHub token — run `gh auth login` first."); break; }
    const who = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "renown", accept: "application/vnd.github+json" } }).catch(() => null);
    if (!who?.ok) { console.log("Couldn't read your GitHub login from the gh token."); break; }
    const login = (await who.json() as { login?: string }).login;
    if (!login) { console.log("No login in the GitHub /user response."); break; }
    const base = cfg.leaderboardEndpoint.replace(/\/$/, "");
    const [profileRes, recapRes] = await Promise.all([
      fetch(`${base}/profile/${encodeURIComponent(login)}`).catch(() => null),
      fetch(`${base}/recap/${encodeURIComponent(login)}?days=7`).catch(() => null),
    ]);
    type Profile = { login: string | null; handle: string; isAi?: boolean; aiAttestation?: { provider: string; verified?: boolean; webauthnVerified?: boolean; expiresAt?: string } | null; score: number; achievements?: { id: string; name: string; tier: string }[] };
    type Recap = { windowDays: number; attributionDelta: number; verifiedDelta: number; newAchievements: { name: string; tier: string }[] };
    const profile = profileRes?.ok ? (await profileRes.json()) as Profile : null;
    const recap = recapRes?.ok ? (await recapRes.json()) as Recap : null;
    console.log(`\n  renown ai-stats — @${login}`);
    console.log("  " + "─".repeat(56));
    if (profile) {
      const att = profile.aiAttestation;
      const trust = !profile.isAi ? "human"
        : att?.verified ? `🤖 ${att.provider} ✓ verified`
        : att?.webauthnVerified ? `🤖 ${att.provider} ✦ self-keyed`
        : att ? `🤖 ${att.provider} (public claim)`
        : "🤖 AI (unattested)";
      console.log(`  identity:        ${trust}`);
      console.log(`  verified score:  ${profile.score.toLocaleString()}`);
      if (att?.expiresAt) {
        const days = Math.round((Date.parse(att.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000));
        console.log(`  expires in:      ${days < 0 ? "EXPIRED" : days + "d"}${days <= 7 && days >= 0 ? "   ⚠️" : ""}`);
      }
    }
    if (recap) {
      const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
      console.log(`\n  past 7 days`);
      console.log(`    verified delta:    ${fmt(recap.verifiedDelta)}`);
      console.log(`    attribution delta: ${fmt(recap.attributionDelta)}`);
      console.log(`    new achievements:  ${recap.newAchievements.length}`);
    }
    if (profile?.achievements && profile.achievements.length > 0) {
      const byTier = profile.achievements.reduce((m, a) => { m[a.tier] = (m[a.tier] ?? 0) + 1; return m; }, {} as Record<string, number>);
      console.log(`\n  earned: ${profile.achievements.length} — ${["mythic", "platinum", "gold", "silver", "bronze"].filter((t) => byTier[t]).map((t) => `${byTier[t]} ${t}`).join(" · ")}`);
    }
    console.log("");
    break;
  }
  case "digest-test": {
    // Preview the stale-attestation digest payload — same shape that lands at
    // RENOWN_DIGEST_WEBHOOK on the Monday cron. Useful when wiring the webhook for
    // the first time to see what fields you have to work with.
    const cfg = loadConfig();
    if (!cfg.leaderboardEndpoint) { console.log("No leaderboard endpoint configured (config.leaderboardEndpoint)."); break; }
    const args = process.argv.slice(3);
    const flag = (name: string): string | undefined => {
      const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
      if (i < 0) return undefined;
      if (args[i].includes("=")) return args[i].split("=", 2)[1];
      return args[i + 1];
    };
    const days = Number(flag("days") ?? 30);
    const r = await fetch(`${cfg.leaderboardEndpoint.replace(/\/$/, "")}/expiring-attestations?withinDays=${days}`).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    type Entry = { login: string | null; handle: string; provider: string | null; expiresAt: string | null; daysUntilExpiry: number };
    const entries = Array.isArray(j) ? j as Entry[] : [];
    console.log(`\nrenown — attestations expiring within ${days} days (${entries.length} entries)`);
    console.log("─".repeat(72));
    if (entries.length === 0) {
      console.log("  (nothing expiring — nothing would be sent to RENOWN_DIGEST_WEBHOOK)");
    } else {
      for (const e of entries) {
        const days = e.daysUntilExpiry;
        const tag = days < 0 ? "expired" : days <= 3 ? "URGENT" : days <= 7 ? "soon" : "ok";
        console.log(`  [${tag.padEnd(7)}] @${(e.login ?? "?").padEnd(20)} ${(e.provider ?? "?").padEnd(12)} in ${days}d`);
      }
    }
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
