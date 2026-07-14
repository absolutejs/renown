// Public /achievements discovery index — the catalog counterpart to the /pets gallery. A live
// network unlock feed up top, then the curated catalog grouped by category. Every achievement
// links to its /achievement/:id share page. Lightweight (no three.js).
import { Head } from "@absolutejs/absolute/react/components";
import { SiteHeader } from "../components/SiteHeader";

type CatalogAch = { id: string; name: string; description: string; tier: string; category: string; unlocks: number; rarity: number };
type RecentUnlock = {
  unlockedAt: string;
  achievement: { id: string; name: string; tier: string; category: string };
  player: { login: string; handle: string; avatarSeed: string | null; isAi: boolean; tier: string };
};
type AchievementsIndex = { players: number; recent: RecentUnlock[]; catalog: CatalogAch[] };

const ago = (iso: string): string => {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const Body = ({ index }: { index: AchievementsIndex }) => {
  // Group the curated catalog by category, preserving the loader's order (category, then unlocks).
  const groups: [string, CatalogAch[]][] = [];
  for (const a of index.catalog) {
    const g = groups.find(([c]) => c === a.category);
    if (g) g[1].push(a); else groups.push([a.category, [a]]);
  }
  return (
    <main className="wrap profilePage">
      <SiteHeader current="achievements" />

      <section className="card">
        <h1 style={{ marginBottom: 4 }}>Achievements</h1>
        <p className="muted">The renown achievement catalog — milestones earned for real dev work. {index.catalog.length} curated achievements across {groups.length} categories. Click any to see its page, rarity, and who's earned it.</p>
      </section>

      {index.recent.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Unlocked across the network</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {index.recent.map((u, i) => (
              <div key={`${u.achievement.id}-${u.player.login}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 8, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                <a href={`/achievement/${encodeURIComponent(u.achievement.id)}`} className={`achChip tier-${u.achievement.tier}`} style={{ textDecoration: "none", color: "inherit", flexShrink: 0 }}>
                  <span className="achName">{u.achievement.name}</span>
                  <span className="achTier">{u.achievement.tier}</span>
                </a>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <a href={`/profile/${encodeURIComponent(u.player.login)}`} style={{ color: "inherit", fontWeight: 600, textDecoration: "none" }}>@{u.player.login}</a>{u.player.isAi && <span title="AI participant"> 🤖</span>}
                </span>
                <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{ago(u.unlockedAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.map(([cat, arr]) => (
        <section className="card" key={cat}>
          <h2 style={{ marginTop: 0 }}>{cat} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {arr.length}</span></h2>
          <div className="achList" style={{ marginTop: 8 }}>
            {arr.map((a) => (
              <a key={a.id} href={`/achievement/${encodeURIComponent(a.id)}`} className={`achChip tier-${a.tier}`} style={{ textDecoration: "none", color: "inherit" }} title={`${a.description} · ${a.rarity}% of players have this (${a.unlocks.toLocaleString()})`}>
                <span className="achName">{a.name}</span>
                <span className="achTier">{a.rarity > 0 ? `${a.rarity}%` : a.tier}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
};

type RenownAchievementsProps = { cssPath?: string; index?: AchievementsIndex; origin?: string };

export const RenownAchievements = ({ cssPath, index = { players: 0, recent: [], catalog: [] }, origin = "" }: RenownAchievementsProps) => {
  const title = "Achievements — the renown catalog";
  const desc = `Browse the renown achievement catalog: ${index.catalog.length} milestones earned for real dev work, plus the live network unlock feed.`;
  const url = `${origin}/achievements`;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={desc}
        canonical={url}
        openGraph={{ title, description: desc, type: "website", url, siteName: "Renown" }}
        twitter={{ card: "summary", title, description: desc }}
      />
      <body>
        <Body index={index} />
      </body>
    </html>
  );
};
