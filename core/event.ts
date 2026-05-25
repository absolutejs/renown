// Event processor — the engine heartbeat.  bun cli/index.ts tick | commit <repo>
// Scores real work (craft), tracks activity/stats, advances quests, scans memory bosses,
// evaluates the 10k achievement catalog (badges), submits to the leaderboard, writes HUD.
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { C, HUD, WATCHED, award, ensureDailyQuests, loadConfig, loadState, renderHud, saveState } from "./runtime.ts";
import type { State } from "./state.ts";
import { evalAll, info } from "./achievements/index.ts";
import { sampleBosses } from "./bosses.ts";
import { repoMeta, scoreCommit } from "./craft.ts";
import { applyGains, awardCraft, skillById } from "./skills.ts";
import { recordActivity, recordCommit } from "./stats.ts";
import { submit } from "./leaderboard.ts";

const cfg = loadConfig();
const events: string[] = [];
const ev = (m: string | null | string[]) => { if (m) for (const x of ([] as string[]).concat(m)) if (x) events.push(x); };
const day = () => new Date().toISOString().slice(0, 10);
const yest = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function touchStreak(s: State) {
  const t = day();
  if (s.lastActiveDay !== t) { s.streak = s.lastActiveDay === yest() ? s.streak + 1 : 1; s.lastActiveDay = t; }
  s.best.streak = Math.max(s.best.streak, s.streak);
}
function progress(s: State, id: string, delta: number) {
  const q = s.quests.find(x => x.id === id); if (!q || q.done || delta <= 0) return;
  q.prog = Math.min(q.goal, q.prog + delta);
  if (q.prog >= q.goal) { q.done = true; ev(`${C.grn}✔ Quest: ${q.desc}${C.r}`); ev(award(s, q.xp, "quest")); }
}
function checkAch(s: State) {                                  // achievements are badges (no XP)
  const have = new Set(Object.keys(s.achievements));
  for (const id of evalAll(s, have)) { s.achievements[id] = Date.now(); have.add(id); const a = info(id); ev(`${C.b}${C.cyn}🏆 ${a?.name ?? id}${C.r}${a?.vis === "secret" ? ` ${C.dim}(secret)${C.r}` : ""}`); }
}

async function reconcile(s: State, repo: string) {
  const sha = (await $`git -C ${repo} rev-parse HEAD`.text().catch(() => "")).trim(); if (!sha) return;
  const prev = s.repoHeads[repo]; s.repoHeads[repo] = sha;
  if (!prev || prev === sha) return;
  const meta = await repoMeta(repo).catch(() => null);
  const key = meta ? `${meta.owner}/${meta.name}` : repo, pname = meta?.name ?? repo.split("/").pop() ?? repo;
  const list = (await $`git -C ${repo} rev-list --no-merges --reverse ${prev}..${sha}`.text().catch(() => "")).trim().split("\n").filter(Boolean).slice(0, 50);
  for (const c of list) {
    const r = await scoreCommit(s, cfg, repo, c).catch(() => null); if (!r) continue;
    s.commits++; s.linesAdded += r.lines;
    for (const l of r.langs) s.langs[l] = (s.langs[l] ?? 0) + 1;
    const cd = new Date(r.committedAt || Date.now()), h = cd.getHours(), d = cd.getDay();
    s.hours[h] = (s.hours[h] ?? 0) + 1; s.days[d] = (s.days[d] ?? 0) + 1;
    if (r.oss) s.ossCommits++; if (r.ext) s.extCommits++; s.topStars = Math.max(s.topStars, r.stars);
    recordCommit(s, key, pname, r); touchStreak(s);
    if (r.xp > 0) ev(award(s, r.xp, `"${r.subject.slice(0, 28)}"${r.oss ? " OSS" : ""}`));
    else ev(`${C.dim}· no XP: ${r.subject.slice(0, 30)} (${r.breakdown[0]})${C.r}`);
    for (const u of applyGains(s.skillXp, awardCraft(r))) { const sk = skillById(u.id); if (sk) ev(`${C.b}${C.grn}${sk.icon} ${sk.name} Lv${u.to}!${C.r}`); }
    progress(s, "earn150", r.xp); progress(s, "lines200", r.lines);
    if (r.oss) progress(s, "oss1", 1); if (r.hasTests) progress(s, "tests", 1);
  }
}
function scanBosses(s: State) {                              // live, universal (core/bosses.ts)
  for (const msg of sampleBosses(s)) { ev(`${C.yel}${msg}${C.r}`); ev(award(s, 30, "slew a boss")); progress(s, "slayboss", 1); }
}
function memTick(s: State) {
  const now = Date.now(), dt = s.lastTick ? Math.min(120, Math.max(0, Math.floor((now - s.lastTick) / 1000))) : 0;
  const p = memTickMem(); s.maxMem = Math.max(s.maxMem, p);
  if (p < 80 && dt > 0) { s.secondsHealthy += dt; progress(s, "marathon", dt); }
  if (new Date().getHours() < 12) progress(s, "earlybird", 1);
}
function memTickMem(): number { try { const t = readFileSync("/proc/meminfo", "utf8"); const kB = (k: string) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0); const tot = kB("MemTotal"); return tot ? Math.round((1 - kB("MemAvailable") / tot) * 100) : 0; } catch { return 0; } }

export async function runEvent(cmd?: string, arg?: string) {
  const s = loadState(); ensureDailyQuests(s);
  if (cmd === "commit" && arg) { await reconcile(s, arg).catch(() => {}); }
  else {
    touchStreak(s); memTick(s); scanBosses(s);
    if (existsSync(WATCHED)) for (const r of [...new Set(readFileSync(WATCHED, "utf8").split("\n").map(x => x.trim()).filter(Boolean))].slice(-40)) await reconcile(s, r).catch(() => {});
    const q = s.quests.find(x => x.id === "polyglot"); if (q && !q.done) { q.prog = Object.keys(s.langs).length; if (q.prog >= q.goal) { q.done = true; ev(award(s, q.xp, "quest")); } }
  }
  checkAch(s); recordActivity(s, s.lifetimeXp, s.commits); s.lastTick = Date.now();
  if (events.length) s.flash = { msg: events[events.length - 1], until: Date.now() + 45000 };
  writeFileSync(HUD, renderHud(s)); saveState(s);
  await submit(s, cfg).catch(() => {});
  if (events.length && process.stdout.isTTY) process.stdout.write("\n" + events.map(e => "  " + e).join("\n") + "\n\n");
}
