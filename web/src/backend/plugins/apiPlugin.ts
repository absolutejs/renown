// Renown API. Reads hit Neon directly (cheap selects); the write path (/submit) goes
// through the write-behind cache + reactive hub in ../sync.ts so we never hammer Neon
// on the per-tick hot path. Skill levels are computed from the shared core/skills.ts.
import { desc, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { SKILLS, levelForXp, skillProgress, totalLevel } from "../../../../core/skills.ts";
import { achievements, playerProjects, players } from "../../../../db/schema.ts";
import { gameDb, playerCache, submitPlayer, type PlayerSnapshot } from "../sync.ts";

const TOP_MAX = 100, ACH_MAX = 2000;

export const apiPlugin = () =>
  new Elysia({ prefix: "/api" })
    .get("/top", async ({ query }) => {
      const n = Math.min(TOP_MAX, Number(query.n ?? 20));
      if (query.skill) {
        const skill = String(query.skill);
        const xpExpr = sql<number>`coalesce((${players.skillXp} ->> ${skill})::int, 0)`;
        const rows = await gameDb.select({ id: players.id, name: players.handle, xp: xpExpr }).from(players).orderBy(desc(xpExpr)).limit(n);
        return rows.map((r) => ({ id: r.id, name: r.name, skill, xp: r.xp, level: levelForXp(r.xp) }));
      }
      if (query.project) {
        const rows = await gameDb.select({ name: players.handle, xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines })
          .from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
          .where(eq(playerProjects.projectKey, String(query.project))).orderBy(desc(playerProjects.xp)).limit(n);
        return rows.map((r) => ({ key: query.project, ...r }));
      }
      const rows = await gameDb.select().from(players).orderBy(desc(players.xp)).limit(n);
      return rows.map((p) => ({ id: p.id, name: p.handle, level: p.level, totalLevel: p.totalLevel, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec }));
    })
    .get("/skills", async ({ query }) => {
      const id = String(query.id ?? "");
      if (!id) return { error: "id required" };
      const snap = playerCache.peek(id) ?? (await playerCache.get(id));   // hot cache first, Neon on miss
      const skx = snap?.skillXp ?? {};
      return {
        id, name: snap?.name ?? null, totalLevel: totalLevel(skx),
        skills: SKILLS.map((sk) => { const xp = skx[sk.id] ?? 0; const pr = skillProgress(xp); return { id: sk.id, name: sk.name, icon: sk.icon, level: pr.level, pct: pr.pct, xp }; })
      };
    })
    .get("/achievements", async ({ query }) => {
      const n = Math.min(ACH_MAX, Number(query.n ?? 500));
      const tp = (await gameDb.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;
      const rows = await gameDb.select().from(achievements).orderBy(desc(achievements.unlockCount)).limit(n);
      return { players: tp, achievements: rows.map((r) => ({ id: r.id, name: r.name, tier: r.tier, unlocks: r.unlockCount, rarity: tp ? +((r.unlockCount / tp) * 100).toFixed(1) : 0 })) };
    })
    .post("/submit", ({ body }) => {
      const e = body as PlayerSnapshot;
      if (!e?.id) return { error: "bad request" };
      submitPlayer(e);   // synchronous hot write + live push; Neon persist coalesced behind it
      return { ok: true };
    });
