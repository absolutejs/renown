// Stats engine — heartbeats + commits → recap-ready history: idle-bridged active time
// & sessions, hour/day heatmaps ("when are you most active"), per-day rollups, and
// per-project + per-language depth (for competitive boards).
import type { State } from "./state.ts";
import type { CraftResult } from "./craft.ts";

const IDLE_GAP = 360;
export const dateKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function recordActivity(s: State, xpNow: number, commitsNow: number) {
  const st = s.stats, now = Date.now();
  st.lastSeen = now;
  if (!st.curStart) { st.curStart = now; st.sessionCount++; st.anchorXp = xpNow; st.anchorCommits = commitsNow; }
  const dt = st.lastActivity ? (now - st.lastActivity) / 1000 : 0;
  if (dt > 0 && dt <= IDLE_GAP) {
    st.activeSec += dt; st.curSec += dt;
    const d = new Date(now); st.hourActive[d.getHours()] += dt; st.dowActive[d.getDay()] += dt;
    (st.daily[dateKey(now)] ??= { a: 0, xp: 0, c: 0, l: 0 }).a += dt;
  } else if (dt > IDLE_GAP) {
    finalize(s, xpNow, commitsNow);
    st.curStart = now; st.curSec = 0; st.sessionCount++; st.anchorXp = xpNow; st.anchorCommits = commitsNow;
  }
  st.lastActivity = now;
  const keys = Object.keys(st.daily); if (keys.length > 420) for (const k of keys.sort().slice(0, keys.length - 420)) delete st.daily[k];
}
function finalize(s: State, xpNow: number, commitsNow: number) {
  const st = s.stats; if (!st.curStart || st.curSec < 30) return;
  st.sessions.unshift({ s: st.curStart, e: st.lastActivity, sec: Math.round(st.curSec), xp: Math.max(0, xpNow - st.anchorXp), c: Math.max(0, commitsNow - st.anchorCommits) });
  st.sessions = st.sessions.slice(0, 100); st.longestSec = Math.max(st.longestSec, st.curSec);
}
export function recordCommit(s: State, key: string, name: string, r: CraftResult) {
  const p = (s.projects[key] ??= { name, commits: 0, lines: 0, xp: 0, first: r.committedAt || Date.now(), last: 0, stars: 0, oss: false, ext: false, activeSec: 0, langs: {} });
  p.commits++; p.lines += r.lines; p.xp += r.xp; p.last = r.committedAt || Date.now();
  p.stars = Math.max(p.stars, r.stars); p.oss ||= r.oss; p.ext = r.ext;
  for (const l of r.langs) { p.langs[l] = (p.langs[l] ?? 0) + 1; const ld = (s.langsDeep[l] ??= { commits: 0, lines: 0, xp: 0 }); ld.commits++; ld.lines += r.lines; ld.xp += r.xp; }
  const ct = r.committedAt || Date.now(), d = new Date(ct);
  s.stats.commitHour[d.getHours()]++; s.stats.commitDow[d.getDay()]++;
  const day = (s.stats.daily[dateKey(ct)] ??= { a: 0, xp: 0, c: 0, l: 0 }); day.xp += r.xp; day.c++; day.l += r.lines;
}
export function sumDays(s: State, days: number) {
  const cut = dateKey(Date.now() - (days - 1) * 86400000);
  let a = 0, xp = 0, c = 0, l = 0, active = 0;
  for (const [k, v] of Object.entries(s.stats.daily)) if (k >= cut) { a += v.a; xp += v.xp; c += v.c; l += v.l; if (v.a > 30 || v.c > 0) active++; }
  return { activeSec: a, xp, commits: c, lines: l, activeDays: active };
}
export const peakHour = (s: State) => { const m = Math.max(...s.stats.hourActive); return m > 0 ? s.stats.hourActive.indexOf(m) : -1; };
export const peakDow = (s: State) => { const m = Math.max(...s.stats.dowActive); return m > 0 ? s.stats.dowActive.indexOf(m) : -1; };
export const topProjects = (s: State, n = 5) => Object.entries(s.projects).map(([k, p]) => ({ k, ...p })).sort((a, b) => b.xp - a.xp).slice(0, n);
export const topLangs = (s: State, n = 6) => Object.entries(s.langsDeep).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.xp - a.xp).slice(0, n);
export function fmtDur(sec: number) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`; }
const SP = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
export const spark = (arr: number[]) => { const mx = Math.max(1, ...arr); return arr.map(v => v <= 0 ? "·" : SP[Math.min(7, Math.round((v / mx) * 7))]).join(""); };
export const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
