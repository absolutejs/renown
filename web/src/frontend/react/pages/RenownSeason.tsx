// Public /season page — the monthly competition. A live board ranking devs by renown gained this
// month, a countdown to the reset, and the Hall of Champions of past seasons. Lightweight, no three.js.
import { Head } from "@absolutejs/absolute/react/components";

type SeasonInfo = { id: string; label: string; daysLeft: number };
type SeasonStanding = { login: string | null; handle: string; gain: number; score: number; tier: string; isAi: boolean; avatarSeed: string | null };
type Champion = { season: string; label: string; rank: number; login: string | null; handle: string; gain: number };
type Season = { season: SeasonInfo; standings: SeasonStanding[]; hall: Champion[] };

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const medal = (rank: number) => ["🥇", "🥈", "🥉"][rank - 1] ?? `#${rank}`;

const Body = ({ data }: { data: Season }) => {
  // Group the hall by season (rows arrive season desc, rank asc).
  const seasons: [string, Champion[]][] = [];
  for (const c of data.hall) {
    const g = seasons.find(([s]) => s === c.season);
    if (g) g[1].push(c); else seasons.push([c.season, [c]]);
  }
  return (
    <main className="wrap profilePage">
      <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a> <a href="/" className="muted" style={{ marginLeft: 12 }}>← Leaderboard</a></header>

      <section className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="muted" style={{ textTransform: "uppercase", letterSpacing: 1, fontSize: 13, fontWeight: 700, margin: 0 }}>Season · {data.season.label}</p>
          <h1 style={{ margin: "2px 0 0" }}>This month's climb</h1>
          <p className="muted" style={{ marginTop: 4 }}>Ranked by renown earned since the 1st. Resets when the month turns — top finishers are enshrined in the Hall.</p>
        </div>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1, color: "#c4b5fd" }}>{data.season.daysLeft}</div>
          <div className="muted" style={{ fontSize: 13 }}>day{data.season.daysLeft === 1 ? "" : "s"} left</div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Standings</h2>
        {data.standings.length === 0
          ? <p className="muted">No one's earned renown yet this season — commit verified work to take the lead.</p>
          : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {data.standings.map((r, i) => (
                <a key={(r.login ?? r.handle) + i} href={r.login ? `/profile/${encodeURIComponent(r.login)}` : "#"}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                  <span style={{ width: 30, textAlign: "right", fontWeight: 700, opacity: 0.85 }}>{medal(i + 1)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{r.login ?? r.handle}{r.isAi && <span title="AI participant"> 🤖</span>}</span>
                  <span className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{fmt(r.score)} total</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, color: "#86efac" }}>+{fmt(r.gain)}</span>
                </a>
              ))}
            </div>
          )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Hall of Champions</h2>
        {seasons.length === 0
          ? <p className="muted">No seasons have finished yet. The first champions are crowned when this month ends.</p>
          : seasons.map(([sid, champs]) => (
            <div key={sid} style={{ marginTop: 10 }}>
              <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{champs[0].label}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {champs.map((c) => (
                  <a key={c.rank} href={c.login ? `/profile/${encodeURIComponent(c.login)}` : "#"}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                    <span style={{ width: 30, textAlign: "right" }}>{medal(c.rank)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>@{c.login ?? c.handle}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, color: "#86efac" }}>+{fmt(c.gain)}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
      </section>
    </main>
  );
};

type RenownSeasonProps = { cssPath?: string; season?: Season; origin?: string };

export const RenownSeason = ({ cssPath, season, origin = "" }: RenownSeasonProps) => {
  const data: Season = season ?? { season: { id: "", label: "", daysLeft: 0 }, standings: [], hall: [] };
  const title = `Season ${data.season.label} — Renown`;
  const desc = `This month's renown competition: ${data.standings.length} devs climbing, ${data.season.daysLeft} days left. Plus the Hall of Champions.`;
  const url = `${origin}/season`;
  return (
    <html lang="en">
      <Head cssPath={cssPath} title={title} description={desc} canonical={url}
        openGraph={{ title, description: desc, type: "website", url, siteName: "Renown" }}
        twitter={{ card: "summary", title, description: desc }} />
      <body><Body data={data} /></body>
    </html>
  );
};
