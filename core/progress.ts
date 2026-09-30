import { totalLevel } from "./skills.ts";

export type ProgressSnapshot = {
  id: string; name?: string; level?: number; xp?: number; streak?: number; oss?: number;
  ach?: number; active?: number; totalLevel?: number; skillXp?: Record<string, number>;
  unlocked?: string[];
  projects?: { key: string; xp?: number; commits?: number; lines?: number }[];
};

export function mergeSkillXp(a: Record<string, number> = {}, b: Record<string, number> = {}) {
  const merged = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (Number.isFinite(value) && value >= 0) merged[key] = Math.max(merged[key] ?? 0, value);
  }
  return merged;
}

// These are snapshots of the same cumulative ledger, not independent grants.
// Adding them would double-count every heartbeat; use maxima and set unions.
export function mergeProgress<T extends ProgressSnapshot>(previous: T | undefined, incoming: T): T {
  if (previous && previous.id !== incoming.id) throw new Error("Cannot merge different Renown players implicitly");
  const merged = { ...previous, ...incoming };
  for (const key of ["level", "xp", "streak", "oss", "ach", "active", "totalLevel"] as const)
    merged[key] = Math.max(previous?.[key] ?? 0, incoming[key] ?? 0);
  merged.skillXp = mergeSkillXp(previous?.skillXp, incoming.skillXp);
  merged.totalLevel = Math.max(merged.totalLevel ?? 0, totalLevel(merged.skillXp));
  if ([undefined, "player", "anon", ""].includes(incoming.name) && previous?.name) merged.name = previous.name;
  merged.unlocked = [...new Set([...(previous?.unlocked ?? []), ...(incoming.unlocked ?? [])])];
  merged.ach = Math.max(merged.ach ?? 0, merged.unlocked.length);
  const projects = new Map((previous?.projects ?? []).map(p => [p.key, p]));
  for (const p of incoming.projects ?? []) {
    const old = projects.get(p.key);
    projects.set(p.key, { ...old, ...p, xp: Math.max(old?.xp ?? 0, p.xp ?? 0), commits: Math.max(old?.commits ?? 0, p.commits ?? 0), lines: Math.max(old?.lines ?? 0, p.lines ?? 0) });
  }
  merged.projects = [...projects.values()];
  return merged;
}
