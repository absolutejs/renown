#!/usr/bin/env bun
// Renown API (Bun + Drizzle/Neon).  bun run server
//   POST /submit                  upsert player + per-project + record unlocks (bumps rarity)
//   GET  /top?n=                   global leaderboard
//   GET  /top?project=owner/name   per-project leaderboard
//   GET  /achievements?n=          catalog ordered by popularity, with live rarity %
// NOTE: trusts client scores (keeps max xp). Add real validation before public launch.
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { achievements, playerAchievements, playerProjects, players, projects } from "../db/schema.ts";

const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const totalPlayers = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(players))[0]?.n ?? 0;

Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (req.method === "POST" && url.pathname === "/submit") {
        const e = await req.json().catch(() => null);
        if (!e?.id) return json({ error: "bad request" }, 400);
        await db.insert(players).values({ id: e.id, handle: String(e.name || "anon").slice(0, 40), level: e.level | 0, xp: e.xp | 0, streak: e.streak | 0, activeSec: e.active | 0, achievements: (e.unlocked?.length) | 0, ossCommits: e.oss | 0, updatedAt: new Date() })
          .onConflictDoUpdate({ target: players.id, set: { handle: sql`excluded.handle`, level: sql`excluded.level`, xp: sql`greatest(${players.xp}, excluded.xp)`, streak: sql`excluded.streak`, activeSec: sql`excluded.active_sec`, achievements: sql`excluded.achievements`, ossCommits: sql`excluded.oss_commits`, updatedAt: sql`now()` } });
        for (const p of Array.isArray(e.projects) ? e.projects : []) {
          if (!p?.key) continue;
          await db.insert(projects).values({ key: p.key, name: p.name || p.key, stars: p.stars | 0, oss: !!p.oss }).onConflictDoUpdate({ target: projects.key, set: { name: sql`excluded.name`, stars: sql`excluded.stars`, oss: sql`excluded.oss` } });
          await db.insert(playerProjects).values({ playerId: e.id, projectKey: p.key, xp: p.xp | 0, commits: p.commits | 0, lines: p.lines | 0, updatedAt: new Date() }).onConflictDoUpdate({ target: [playerProjects.playerId, playerProjects.projectKey], set: { xp: sql`greatest(${playerProjects.xp}, excluded.xp)`, commits: sql`excluded.commits`, lines: sql`excluded.lines`, updatedAt: sql`now()` } });
        }
        const unlocked: string[] = Array.isArray(e.unlocked) ? e.unlocked.filter((x: unknown) => typeof x === "string").slice(0, 12000) : [];
        if (unlocked.length) {
          // only ids that exist in the catalog (avoid FK errors from version skew)
          const valid = await db.select({ id: achievements.id }).from(achievements).where(inArray(achievements.id, unlocked));
          if (valid.length) {
            const ins = await db.insert(playerAchievements).values(valid.map(v => ({ playerId: e.id, achievementId: v.id }))).onConflictDoNothing().returning({ id: playerAchievements.achievementId });
            if (ins.length) await db.update(achievements).set({ unlockCount: sql`${achievements.unlockCount} + 1` }).where(inArray(achievements.id, ins.map(r => r.id)));
          }
        }
        return json({ ok: true });
      }
      if (url.pathname === "/top") {
        const n = Math.min(100, Number(url.searchParams.get("n") ?? 20));
        const proj = url.searchParams.get("project");
        if (proj) {
          const rows = await db.select({ name: players.handle, xp: playerProjects.xp, commits: playerProjects.commits, lines: playerProjects.lines }).from(playerProjects).innerJoin(players, eq(players.id, playerProjects.playerId)).where(eq(playerProjects.projectKey, proj)).orderBy(desc(playerProjects.xp)).limit(n);
          return json(rows.map(r => ({ key: proj, name: r.name, xp: r.xp, commits: r.commits, lines: r.lines })));
        }
        const rows = await db.select().from(players).orderBy(desc(players.xp)).limit(n);
        return json(rows.map(p => ({ id: p.id, name: p.handle, level: p.level, xp: p.xp, streak: p.streak, oss: p.ossCommits, ach: p.achievements, active: p.activeSec })));
      }
      if (url.pathname === "/achievements") {
        const n = Math.min(2000, Number(url.searchParams.get("n") ?? 500));
        const tp = await totalPlayers();
        const rows = await db.select().from(achievements).orderBy(desc(achievements.unlockCount)).limit(n);
        return json({ players: tp, achievements: rows.map(r => ({ id: r.id, name: r.name, tier: r.tier, unlocks: r.unlockCount, rarity: tp ? +(r.unlockCount / tp * 100).toFixed(1) : 0 })) });
      }
      return new Response("Renown API ⚔", { headers: cors });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
});
console.log(`Renown API on :${process.env.PORT ?? 8787}`);
