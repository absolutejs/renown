// Renown TUI — Hero · Quests · Achievements · Bestiary · Leaderboard · Recap.
// Live (1s) HP from memory; keyboard nav. Launched by cli/index.ts.
import { C, availG, bar, loadConfig, loadState, memPct, paint, strip } from "../core/runtime.ts";
import { type State, levelInfo, titleFor } from "../core/state.ts";
import { CURATED, curatedCount, info, totalCount } from "../core/achievements/index.ts";
import { type Entry, type ProjEntry, type Rarity, fetchBoard, fetchProjectBoard, fetchRarity } from "../core/leaderboard.ts";
import { DOW, fmtDur, peakDow, peakHour, spark, sumDays, topLangs, topProjects } from "../core/stats.ts";

const W = () => Math.max(64, Math.min(104, process.stdout.columns || 90));
const cfg = loadConfig();
const refresh = () => { try { Bun.spawnSync([process.execPath, `${import.meta.dir}/index.ts`, "tick"], { stdout: "ignore", stderr: "ignore" }); } catch {} };
let s: State = loadState();
let board: { entries: Entry[]; live: boolean } = { entries: [], live: false };
let projBoard: { entries: ProjEntry[]; live: boolean } = { entries: [], live: false };
let lbSel = 0;
let rarity: Rarity = { map: {}, players: 0, live: false };
const loadBoard = async () => { try { board = await fetchBoard(s, cfg); } catch {} };
const loadRarity = async () => { try { rarity = await fetchRarity(cfg); } catch {} };
const loadProj = async () => { const tp = topProjects(s, 6); if (lbSel > 0 && tp[lbSel - 1]) { try { projBoard = await fetchProjectBoard(s, cfg, tp[lbSel - 1].k); } catch {} } };

const TABS = ["Hero", "Quests", "Achievements", "Bestiary", "Leaderboard", "Recap"];
const N = TABS.length;
let tab = Math.min(N - 1, Math.max(0, Number(process.env.DQ_TAB ?? 0)));
const ONESHOT = !!process.env.DQ_ONESHOT;
const pad = (x: string, n: number) => x + " ".repeat(Math.max(0, n - strip(x).length));
const TIERCOL: Record<string, string> = { bronze: C.orange, silver: C.wht, gold: C.gold, platinum: C.cyn, mythic: C.mag, secret: C.gold };
function box(title: string, rows: string[]): string[] {
  const w = W(), wide = [...strip(title)].filter(c => (c.codePointAt(0) ?? 0) > 0x2190).length;
  const out = [`${C.gry}╭─ ${C.b}${C.cyn}${title}${C.r} ${C.gry}${"─".repeat(Math.max(0, w - 4 - strip(title).length - wide))}╮${C.r}`];
  for (const r of rows) out.push(`${C.gry}│${C.r} ${r}`);
  out.push(`${C.gry}╰${"─".repeat(w - 2)}╯${C.r}`); return out;
}
function header(): string[] {
  const li = levelInfo(s.xp), used = memPct(), free = availG(), hp = used >= 80 ? C.red : used >= 70 ? C.yel : C.grn;
  return box(`⚔  RENOWN  —  ${s.name}`, [
    `${C.b}${C.mag}Lv ${li.level}${C.r}  ${C.b}${titleFor(li.level)}${C.r}    ${s.streak > 0 ? `${C.orange}🔥 ${s.streak}d${C.r}` : ""}    ${C.dim}${s.lifetimeXp} lifetime XP${C.r}`,
    `XP  ${bar(li.pct, 30, C.mag)} ${C.dim}${li.into}/${li.need}${C.r}`,
    `HP  ${bar(100 - used, 30, hp)} ${paint(`${free.toFixed(1)}G free`, hp)} ${C.dim}(${used}% used)${C.r}`,
  ]);
}
const heroTab = () => box("Hero", [
  `${C.cyn}commits${C.r} ${C.b}${s.commits}${C.r}   ${C.cyn}lines${C.r} ${C.b}${s.linesAdded}${C.r}   ${C.cyn}languages${C.r} ${C.b}${Object.keys(s.langs).length}${C.r}`,
  `${C.cyn}open-source${C.r} ${C.b}${s.ossCommits}${C.r}  ${C.cyn}for others${C.r} ${C.b}${s.extCommits}${C.r}  ${C.cyn}top project${C.r} ${C.b}${s.topStars}★${C.r}`,
  `${C.cyn}bosses${C.r} ${C.b}${s.bossesSurvived}${C.r}  ${C.cyn}badges${C.r} ${C.b}${Object.keys(s.achievements).length}/${totalCount()}${C.r}  ${C.cyn}active${C.r} ${C.b}${fmtDur(s.stats.activeSec)}${C.r}`,
  "", paint(`"${memPct() >= 80 ? "the heap burns — hold the line." : s.streak >= 7 ? `${s.streak} days strong.` : "all quiet. ship something great."}"`, C.dim + C.it),
]);
function questsTab() {
  const rows = [`${C.dim}daily quests — reset at midnight${C.r}`, ""];
  for (const q of s.quests) { const pct = Math.floor((q.prog / q.goal) * 100); rows.push(`${q.done ? `${C.grn}✔${C.r}` : `${C.gry}○${C.r}`} ${pad(q.done ? paint(q.desc, C.grn) : q.desc, 32)} ${bar(pct, 12)} ${C.dim}${q.prog}/${q.goal}${C.r} ${C.yel}+${q.xp}${C.r}`); }
  return box("Quests", rows);
}
function achTab() {
  const got = (id: string) => !!s.achievements[id];
  const rar = (id: string): number | undefined => rarity.map[id];
  const recent = Object.entries(s.achievements).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([id]) => info(id)).filter((x): x is NonNullable<typeof x> => !!x);
  const cats = [...new Set(CURATED.map(a => a.cat))].map(c => { const l = CURATED.filter(a => a.cat === c); return `${c} ${C.b}${l.filter(a => got(a.id)).length}/${l.length}${C.r}`; });
  const cur = CURATED.filter(a => got(a.id)).length;
  const owned = Object.keys(s.achievements).filter(id => rar(id) !== undefined);
  const rarest = owned.length ? owned.reduce((m, id) => (rar(id)! < rar(m)! ? id : m)) : null;
  const rows = [`${C.b}${Object.keys(s.achievements).length}${C.r}${C.dim}/${totalCount()} unlocked · ${cur}/${curatedCount()} curated${rarity.players ? ` · rarity from ${rarity.players} player${rarity.players > 1 ? "s" : ""}${rarity.live ? "" : " (cached)"}` : ""}${C.r}`];
  if (rarest) rows.push(`${C.gold}rarest badge:${C.r} ${info(rarest)?.name} ${C.dim}(${rar(rarest)}% of players)${C.r}`);
  rows.push("", `${C.gold}recently earned:${C.r}`);
  for (const a of recent) { const rr = rar(a.id); rows.push(`  ${paint("🏆 " + a.name, TIERCOL[a.tier] ?? C.wht)}${rr !== undefined ? ` ${C.dim}${rr}% have it${C.r}` : ""}`); }
  if (!recent.length) rows.push(`  ${C.dim}none yet — commit something real${C.r}`);
  if (!rarity.players && !cfg.leaderboardEndpoint) rows.push("", `${C.dim}set leaderboardEndpoint + run the server for live rarity %${C.r}`);
  rows.push("", `${C.dim}curated by category:${C.r}`, `${C.dim}${cats.join("  ·  ")}${C.r}`);
  return box("Achievements", rows);
}
function bestiaryTab() {
  const e = Object.values(s.bestiary).sort((a, b) => b.gb - a.gb);
  const rows = e.length ? [] : [paint("no monsters faced yet.", C.dim)];
  for (const b of e) rows.push(`${b.emoji}  ${pad(paint(b.name, C.b + C.red), 22)} ${C.orange}${b.gb.toFixed(1)}GB peak${C.r}  ${C.dim}×${b.count}${C.r}  ${b.legend ? `${C.b}${C.gold}★LEGEND★${C.r}` : ""}`);
  return box("Bestiary  —  from your watchdog logs", rows);
}
function lbTab() {
  const tp = topProjects(s, 6);
  if (lbSel === 0) {
    const rows: string[] = [];
    (board.entries.length ? board.entries : [{ name: s.name, level: levelInfo(s.xp).level, xp: s.lifetimeXp, streak: s.best.streak, oss: s.ossCommits, ach: Object.keys(s.achievements).length, you: true } as Entry]).forEach((e, i) => {
      rows.push(`${["🥇", "🥈", "🥉"][i] ?? ` ${i + 1}`} ${pad(e.you ? `${C.b}${C.grn}${e.name} (you)${C.r}` : e.name, 24)} ${C.mag}Lv${e.level}${C.r} ${C.dim}${e.xp}XP · 🔥${e.streak} · ${e.ach}🏆${C.r}`);
    });
    rows.push("", cfg.leaderboardEndpoint ? paint(board.live ? "● live global" : "○ cached", board.live ? C.grn : C.yel) : paint("solo — set leaderboardEndpoint in config.json to compete", C.dim), `${C.dim}[p] per-project board →${C.r}`);
    return box("Leaderboard · Global", rows);
  }
  const p = tp[lbSel - 1]; const rows: string[] = [];
  (projBoard.entries.length ? projBoard.entries : []).forEach((e, i) => rows.push(`${["🥇", "🥈", "🥉"][i] ?? ` ${i + 1}`} ${pad(e.you ? `${C.b}${C.grn}${e.name} (you)${C.r}` : e.name, 22)} ${C.mag}${e.xp}XP${C.r} ${C.dim}${e.commits}c · ${e.lines}l${C.r}`));
  if (!projBoard.entries.length) rows.push(paint("no data", C.dim));
  rows.push("", cfg.leaderboardEndpoint ? paint(projBoard.live ? "● live" : "○ cached", projBoard.live ? C.grn : C.yel) : paint("solo — deploy server.example.ts to rank vs others", C.dim), `${C.dim}[p] next project → (${lbSel}/${tp.length})${C.r}`);
  return box(`Leaderboard · ${p?.name ?? "project"}${p?.oss ? " (OSS)" : ""}${p?.stars ? ` ${p.stars}★` : ""}`, rows);
}
function recapTab() {
  const st = s.stats, wk = sumDays(s, 7), mo = sumDays(s, 30), ph = peakHour(s), pd = peakDow(s);
  const dow = DOW.map((d, i) => `${d}${spark([st.dowActive[i], Math.max(...st.dowActive)])[0]}`).join(" ");
  return box("Recap", [
    `${C.cyn}active time${C.r}  ${C.b}${fmtDur(st.activeSec)}${C.r} lifetime  ${C.dim}·${C.r}  ${C.b}${fmtDur(wk.activeSec)}${C.r} this week`,
    `${C.cyn}sessions${C.r}     ${C.b}${st.sessionCount}${C.r}  ${C.dim}· longest ${fmtDur(st.longestSec)} · avg ${fmtDur(st.sessionCount ? st.activeSec / st.sessionCount : 0)}${C.r}`,
    "",
    `${C.cyn}when active${C.r}  ${C.gold}${spark(st.hourActive)}${C.r}  ${C.dim}0───6───12──18─23${C.r}` + (ph >= 0 ? `  ${C.yel}peak ${String(ph).padStart(2, "0")}:00${C.r}` : ""),
    `             ${dow}` + (pd >= 0 ? `   ${C.yel}peak ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][pd]}${C.r}` : ""),
    "",
    `${C.cyn}this week${C.r}    ${C.b}${wk.xp}${C.r} XP · ${wk.commits} commits · ${wk.lines} lines · ${wk.activeDays} active days`,
    `${C.cyn}this month${C.r}   ${C.b}${mo.xp}${C.r} XP · ${mo.commits} commits · ${mo.lines} lines · ${mo.activeDays} active days`,
    "",
    `${C.cyn}top projects${C.r} ${topProjects(s, 3).map(p => `${p.name} ${C.b}${p.xp}${C.r}`).join(C.dim + " · " + C.r) || C.dim + "none yet" + C.r}`,
    `${C.cyn}top langs${C.r}    ${topLangs(s, 5).map(l => `${l.k} ${C.b}${l.xp}${C.r}`).join(C.dim + " · " + C.r) || C.dim + "none yet" + C.r}`,
  ]);
}
function render(clear = true) {
  const tb = TABS.map((t, i) => i === tab ? `${C.inv}${C.b} ${t} ${C.r}` : `${C.dim} ${t} ${C.r}`).join(`${C.gry}·${C.r}`);
  const body = [heroTab, questsTab, achTab, bestiaryTab, lbTab, recapTab][tab]();
  const out = ["", ...header(), "", "  " + tb, "", ...body, "", `  ${C.dim}[1-6] tabs  [←/→]  ${tab === 4 ? "[p] project  " : ""}[r] refresh  [q] quit${C.r}`, s.flash && s.flash.until > Date.now() ? `  ${s.flash.msg}` : ""];
  process.stdout.write((clear ? "\x1b[2J\x1b[H" : "") + out.join("\n") + "\n");
}
export async function runTui() {
  if (!process.stdin.isTTY || ONESHOT) { refresh(); s = loadState(); if (tab === 4) await loadBoard(); if (tab === 2) await loadRarity(); render(false); return; }
  const quit = () => { try { process.stdin.setRawMode(false); } catch {} process.stdout.write("\x1b[?25h\x1b[?1049l"); process.exit(0); };
  refresh(); s = loadState(); loadBoard().then(render); loadRarity().then(render);
  process.stdout.write("\x1b[?1049h\x1b[?25l"); render();
  process.stdin.setRawMode(true); process.stdin.resume();
  process.stdin.on("data", (b: Buffer) => {
    const key = b.toString();
    if (key === "\x03" || key === "q") return quit();
    if (key >= "1" && key <= "6") tab = +key - 1;
    else if (key === "\x1b[C" || key === "l") tab = (tab + 1) % N;
    else if (key === "\x1b[D" || key === "h") tab = (tab + (N - 1)) % N;
    else if (key === "p" && tab === 4) { lbSel = (lbSel + 1) % (topProjects(s, 6).length + 1); loadProj().then(render); }
    else if (key === "r") { refresh(); s = loadState(); loadBoard().then(render); loadRarity().then(render); }
    if (tab === 4 && lbSel === 0 && !board.entries.length) loadBoard().then(render);
    if (tab === 2 && !rarity.players) loadRarity().then(render);
    render();
  });
  setInterval(() => { s = loadState(); render(); }, 1000);
  process.on("SIGINT", quit); process.on("SIGTERM", quit);
}
