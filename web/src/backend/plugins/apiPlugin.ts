// Renown API — same Neon DB as the engine. Reuses the game tables from ../db via a
// drizzle client. (Auth-gated submit comes when login is wired; reads are public.)
import { neon } from "@neondatabase/serverless";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { Elysia } from "elysia";
import { achievements, playerAchievements, playerProjects, players, projects } from "../../../../db/schema.ts";

const gdb = drizzle(neon(process.env.DATABASE_URL!));

export const apiPlugin = () =>
  new Elysia({ prefix: "/api" })
    .get("/top", async ({ query }) => {
      const n = Math.min(100, Number(query.n ?? 20));
      if (query.project) {
        const rows = await gdb.select({ name: players.handle, xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines })
          .from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId))
          .where(eq(playerProjects.projectKey, String(query.project))).orderBy(desc(playerProjects.xp)).limit(n);
        return rows.map(r => ({ key: query.project, ...r }));
      }
      const rows = await gdb.select().from(players).orderBy(desc(players.xp)).limit(n);
      return rows.map(p => ({ id: p.id, name: p.handle, level: p.level, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec }));
    })
    .get("/achievements", async ({ query }) => {
      const n = Math.min(2000, Number(query.n ?? 500));
      const tp = (await gdb.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;
      const rows = await gdb.select().from(achievements).orderBy(desc(achievements.unlockCount)).limit(n);
      return { players: tp, achievements: rows.map(r => ({ id: r.id, name: r.name, tier: r.tier, unlocks: r.unlockCount, rarity: tp ? +(r.unlockCount / tp * 100).toFixed(1) : 0 })) };
    })
    .post("/submit", async ({ body }) => {
      const e = body as any;
      if (!e?.id) return { error: "bad request" };
      await gdb.insert(players).values({ id: e.id, handle: String(e.name || "anon").slice(0, 40), level: e.level | 0, xp: e.xp | 0, streak: e.streak | 0, activeSec: e.active | 0, achievements: (e.unlocked?.length) | 0, ossCommits: e.oss | 0, updatedAt: new Date() })
        .onConflictDoUpdate({ target: players.id, set: { handle: sql`excluded.handle`, level: sql`excluded.level`, xp: sql`greatest(${players.xp}, excluded.xp)`, streak: sql`excluded.streak`, activeSec: sql`excluded.active_sec`, achievements: sql`excluded.achievements`, ossCommits: sql`excluded.oss_commits`, updatedAt: sql`now()` } });
      for (const p of Array.isArray(e.projects) ? e.projects : []) {
        if (!p?.key) continue;
        await gdb.insert(projects).values({ key: p.key, name: p.name || p.key, stars: p.stars | 0, oss: !!p.oss }).onConflictDoUpdate({ target: projects.key, set: { name: sql`excluded.name`, stars: sql`excluded.stars`, oss: sql`excluded.oss` } });
        await gdb.insert(playerProjects).values({ playerId: e.id, projectKey: p.key, xp: p.xp | 0, commits: p.commits | 0, lines: p.lines | 0, updatedAt: new Date() }).onConflictDoUpdate({ target: [playerProjects.playerId, playerProjects.projectKey], set: { xp: sql`greatest(${playerProjects.xp}, excluded.xp)`, commits: sql`excluded.commits`, lines: sql`excluded.lines`, updatedAt: sql`now()` } });
      }
      const unlocked: string[] = Array.isArray(e.unlocked) ? e.unlocked.filter((x: unknown) => typeof x === "string").slice(0, 12000) : [];
      if (unlocked.length) {
        const valid = await gdb.select({ id: achievements.id }).from(achievements).where(inArray(achievements.id, unlocked));
        if (valid.length) {
          const ins = await gdb.insert(playerAchievements).values(valid.map(v => ({ playerId: e.id, achievementId: v.id }))).onConflictDoNothing().returning({ id: playerAchievements.achievementId });
          if (ins.length) await gdb.update(achievements).set({ unlockCount: sql`${achievements.unlockCount} + 1` }).where(inArray(achievements.id, ins.map(r => r.id)));
        }
      }
      return { ok: true };
    });
