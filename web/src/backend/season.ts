// Monthly seasons — a recurring competition layered on the attribution signal. Each calendar
// month is a season; the board ranks devs by renown GAINED that month (current attribution_score
// minus their earliest snapshot of the month — the same baseline trick the weekly board uses).
// When a month rolls over, the just-finished season is finalized into the Hall of Champions
// lazily on the next board load (no cron, no schedule drift — mirrors the lazy daily snapshot).
import { and, desc, eq, sql } from "drizzle-orm";
import { players, seasonChampions } from "../../../db/schema.ts";
import { normalizeTier } from "./billing/tiers";
import { notifySeasonWon } from "./push.ts";
import { gameDb } from "./sync.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type SeasonInfo = { id: string; label: string; daysLeft: number };
export type SeasonStanding = { login: string | null; handle: string; gain: number; score: number; tier: string; isAi: boolean; avatarSeed: string | null };
export type Champion = { season: string; label: string; rank: number; login: string | null; handle: string; gain: number };
export type Season = { season: SeasonInfo; standings: SeasonStanding[]; hall: Champion[] };

const labelFor = (id: string) => { const [y, m] = id.split("-"); return `${MONTHS[Number(m) - 1]} ${y}`; };

const seasonNow = (now: Date): { id: string; start: string; nextStart: string; prevId: string; prevStart: string; daysLeft: number } => {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const pad = (n: number) => String(n + 1).padStart(2, "0");
  const id = `${y}-${pad(m)}`;
  const start = `${id}-01`;
  const next = new Date(Date.UTC(y, m + 1, 1));
  const nextStart = next.toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const prevId = prev.toISOString().slice(0, 7);
  const prevStart = `${prevId}-01`;
  const daysLeft = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 86_400_000));
  return { id, start, nextStart, prevId, prevStart, daysLeft };
};

// Finalize a completed month into the Hall (idempotent — skips if already recorded). Gain over the
// month = max(attribution_score) - min(attribution_score) across that month's snapshots per player.
const finalizeSeason = async (seasonId: string, start: string, endExclusive: string): Promise<void> => {
  const already = await gameDb.select({ r: seasonChampions.rank }).from(seasonChampions).where(eq(seasonChampions.season, seasonId)).limit(1);
  if (already.length > 0) return;
  const rows = (await gameDb.execute(sql`
    SELECT s.player_id, (max(s.attribution_score) - min(s.attribution_score)) AS gain,
           p.github_login AS login, p.handle AS handle
    FROM player_attribution_snapshots s
    JOIN players p ON p.id = s.player_id AND p.github_verified = true
    WHERE s.snapshot_date >= ${start} AND s.snapshot_date < ${endExclusive}
    GROUP BY s.player_id, p.github_login, p.handle
    HAVING (max(s.attribution_score) - min(s.attribution_score)) > 0
    ORDER BY gain DESC
    LIMIT 3
  `)).rows as unknown as { player_id: string; gain: number; login: string | null; handle: string }[];
  if (rows.length === 0) return;
  const inserted = await gameDb.insert(seasonChampions)
    .values(rows.map((r, i) => ({ season: seasonId, rank: i + 1, playerId: r.player_id, login: r.login, handle: r.handle, gain: Number(r.gain) })))
    .onConflictDoNothing()
    .returning({ playerId: seasonChampions.playerId, rank: seasonChampions.rank });
  const label = labelFor(seasonId);
  for (const c of inserted) void notifySeasonWon(c.playerId, label, c.rank);   // crown the champions
};

export const loadSeason = async (n = 25): Promise<Season> => {
  const s = seasonNow(new Date());
  // Lazy rollover: finalize the just-completed month into the Hall if we haven't yet.
  await finalizeSeason(s.prevId, s.prevStart, s.start).catch(() => {});

  // Current standings: renown gained this month (attribution_score - earliest-in-month snapshot).
  const gain = sql<number>`(${players.attributionScore} - coalesce((select sn.attribution_score from player_attribution_snapshots sn where sn.player_id = ${players.id} and sn.snapshot_date >= ${s.start} order by sn.snapshot_date asc limit 1), ${players.attributionScore}))`;
  const rows = await gameDb.select({
    login: players.githubLogin, handle: players.handle, tier: players.tier, isAi: players.isAi,
    avatarSeed: players.avatarSeed, score: players.verifiedScore, gain,
  }).from(players).where(eq(players.githubVerified, true)).orderBy(desc(gain)).limit(n);
  const standings: SeasonStanding[] = rows
    .map((r) => ({ login: r.login, handle: r.handle, gain: Math.max(0, Number(r.gain)), score: Number(r.score), tier: normalizeTier(r.tier), isAi: r.isAi, avatarSeed: r.avatarSeed }))
    .filter((r) => r.gain > 0);

  const champRows = await gameDb.select().from(seasonChampions).orderBy(desc(seasonChampions.season), seasonChampions.rank);
  const hall: Champion[] = champRows.map((c) => ({ season: c.season, label: labelFor(c.season), rank: c.rank, login: c.login, handle: c.handle, gain: Number(c.gain) }));

  return { season: { id: s.id, label: labelFor(s.id), daysLeft: s.daysLeft }, standings, hall };
};
