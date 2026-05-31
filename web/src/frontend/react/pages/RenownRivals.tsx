// Public /rivals/:login page — a dev's "circle": the people they follow (plus themselves) as a
// mini-leaderboard, and the recent-unlock activity feed among them. Following is public, so this
// is both your personal rivals board and a way to discover a dev's circle. Lightweight, no three.js.
import { Head } from "@absolutejs/absolute/react/components";

type RivalRow = { login: string | null; handle: string; score: number; tier: string; isAi: boolean; totalLevel: number; ach: number; petsCount: number; avatarSeed: string | null; verified: boolean; you: boolean };
type RivalFeedItem = { unlockedAt: string; achievement: { id: string; name: string; tier: string }; player: { login: string | null; handle: string; isAi: boolean } };
type Rivals = { login: string; handle: string; following: number; board: RivalRow[]; feed: RivalFeedItem[] };

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const ago = (iso: string): string => {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const Body = ({ rivals }: { rivals: Rivals }) => {
  const me = rivals.login;
  return (
    <main className="wrap profilePage">
      <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a> <a href="/" className="muted" style={{ marginLeft: 12 }}>← Leaderboard</a></header>

      <section className="card">
        <h1 style={{ marginBottom: 4 }}>@{me}'s rivals</h1>
        <p className="muted">The {rivals.following} dev{rivals.following === 1 ? "" : "s"} @{me} follows, ranked head-to-head — and their recent unlocks. <a href={`/profile/${encodeURIComponent(me)}`}>@{me}'s profile →</a></p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Standings</h2>
        {rivals.board.length <= 1
          ? <p className="muted">@{me} isn't following anyone yet. Open a profile and hit <strong>Follow</strong> to build a rivals board.</p>
          : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {rivals.board.map((r, i) => (
                <a key={(r.login ?? r.handle) + i} href={r.login ? `/profile/${encodeURIComponent(r.login)}` : "#"}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit",
                    background: r.you ? "rgba(134,239,172,.10)" : "rgba(255,255,255,.03)", border: `1px solid ${r.you ? "rgba(134,239,172,.4)" : "rgba(255,255,255,.06)"}` }}>
                  <span style={{ width: 28, textAlign: "right", fontWeight: 700, opacity: 0.8 }}>{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    @{r.login ?? r.handle}{r.isAi && <span title="AI participant"> 🤖</span>}{r.you && <span style={{ color: "#86efac", fontSize: 12, fontWeight: 700 }}> ← you</span>}
                  </span>
                  <span className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>L{r.totalLevel} · {fmt(r.ach)} ach</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{fmt(r.score)}</span>
                </a>
              ))}
            </div>
          )}
      </section>

      {rivals.feed.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Recent activity</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {rivals.feed.map((u, i) => (
              <div key={`${u.achievement.id}-${u.player.login}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 8, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <a href={u.player.login ? `/profile/${encodeURIComponent(u.player.login)}` : "#"} style={{ color: "inherit", fontWeight: 600, textDecoration: "none" }}>@{u.player.login ?? u.player.handle}</a>
                  <span className="muted"> unlocked </span>
                  <a href={`/achievement/${encodeURIComponent(u.achievement.id)}`} className={`achChip tier-${u.achievement.tier}`} style={{ textDecoration: "none", color: "inherit" }}><span className="achName">{u.achievement.name}</span></a>
                </span>
                <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{ago(u.unlockedAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
};

const NotFound = ({ login }: { login: string }) => (
  <main className="wrap profilePage">
    <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a></header>
    <section className="card"><h1>@{login} isn't on renown yet</h1><p className="muted">No such player.</p><p><a href="/">← Browse the leaderboard</a></p></section>
  </main>
);

type RenownRivalsProps = { cssPath?: string; rivals?: Rivals | null; login?: string; origin?: string };

export const RenownRivals = ({ cssPath, rivals = null, login = "", origin = "" }: RenownRivalsProps) => {
  const who = rivals?.login ?? login;
  const title = `@${who}'s rivals on Renown`;
  const desc = rivals ? `The ${rivals.following} devs @${who} follows, ranked head-to-head, plus their recent unlocks.` : `${who} on Renown.`;
  const url = `${origin}/rivals/${who}`;
  return (
    <html lang="en">
      <Head cssPath={cssPath} title={title} description={desc} canonical={url}
        openGraph={{ title, description: desc, type: "website", url, siteName: "Renown" }}
        twitter={{ card: "summary", title, description: desc }} />
      <body>{rivals ? <Body rivals={rivals} /> : <NotFound login={who} />}</body>
    </html>
  );
};
