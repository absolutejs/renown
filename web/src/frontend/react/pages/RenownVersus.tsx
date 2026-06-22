// Public /vs/:a/:b page — two devs head to head across every renown dimension, with a verdict
// and a shareable OG card. Reuses the canonical 2D pet sprite for avatars. Lightweight, no three.js.
import { Head } from "@absolutejs/absolute/react/components";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

type VsSide = { login: string; handle: string; tier: string; isAi: boolean; avatarSeed: string | null; score: number; totalLevel: number; achievements: number; petsCount: number; rarestPetScore: number; reviews: number; crossRepo: number; merged: number; downloads: number };
type VsDim = { key: string; label: string; a: number; b: number; winner: "a" | "b" | "tie"; float?: boolean };
type Versus = { a: VsSide; b: VsSide; dims: VsDim[]; verdict: { leader: "a" | "b" | "tie"; text: string; aWins: number; bWins: number } };
type VsResult = Versus | { error: string; missing?: string };

const fmt = (n: number, float?: boolean) => float ? n.toFixed(2) : (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : Math.round(n).toLocaleString("en-US"));
const WIN = "#86efac";

const Pet = ({ seed }: { seed: string | null }) => {
  if (!seed) return <span style={{ width: 96, height: 96, display: "inline-block" }} />;
  const { svg, width, height } = spriteToSvg(generate(seed), { box: 96 });
  return <span style={{ width: 96, height: 96, display: "inline-flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>` }} />;
};

const Corner = ({ s, win }: { s: VsSide; win: boolean }) => (
  <a href={`/profile/${encodeURIComponent(s.login)}`} style={{ flex: 1, textAlign: "center", textDecoration: "none", color: "inherit" }}>
    <Pet seed={s.avatarSeed} />
    <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>@{s.login}{s.isAi && " 🤖"}{win && <span style={{ color: "#ffd66b" }}> 👑</span>}</div>
    <div style={{ fontWeight: 900, fontSize: 26, color: win ? WIN : "inherit" }}>{fmt(s.score)}</div>
    <div className="muted" style={{ fontSize: 12 }}>renown</div>
  </a>
);

const Body = ({ vs }: { vs: Versus }) => (
  <main className="wrap profilePage">
    <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a> <a href="/" className="muted" style={{ marginLeft: 12 }}>← Leaderboard</a></header>

    <section className="card">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Corner s={vs.a} win={vs.verdict.leader === "a"} />
        <div style={{ alignSelf: "center", fontWeight: 950, fontSize: 28, opacity: 0.7, padding: "0 6px" }}>VS</div>
        <Corner s={vs.b} win={vs.verdict.leader === "b"} />
      </div>
      <p style={{ textAlign: "center", marginTop: 14, fontWeight: 700 }}>{vs.verdict.text}</p>
    </section>

    <section className="card">
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {vs.dims.map((d) => (
          <div key={d.key} style={{ display: "flex", alignItems: "center", padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
            <span style={{ flex: 1, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: d.winner === "a" ? 800 : 500, color: d.winner === "a" ? WIN : "inherit" }}>{fmt(d.a, d.float)}{d.winner === "a" && " ◀"}</span>
            <span className="muted" style={{ width: 150, textAlign: "center", fontSize: 13, flexShrink: 0 }}>{d.label}</span>
            <span style={{ flex: 1, textAlign: "left", fontVariantNumeric: "tabular-nums", fontWeight: d.winner === "b" ? 800 : 500, color: d.winner === "b" ? WIN : "inherit" }}>{d.winner === "b" && "▶ "}{fmt(d.b, d.float)}</span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ textAlign: "center", marginTop: 12, fontSize: 13 }}>Categories won: <strong style={{ color: vs.verdict.aWins >= vs.verdict.bWins ? WIN : "inherit" }}>@{vs.a.login} {vs.verdict.aWins}</strong> · <strong style={{ color: vs.verdict.bWins > vs.verdict.aWins ? WIN : "inherit" }}>{vs.verdict.bWins} @{vs.b.login}</strong></p>
    </section>
  </main>
);

const NotFound = ({ who }: { who: string }) => (
  <main className="wrap profilePage">
    <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a></header>
    <section className="card"><h1>Can't compare</h1><p className="muted">{who ? `@${who} isn't on renown yet.` : "Pick two different devs to compare."}</p><p><a href="/">← Browse the leaderboard</a></p></section>
  </main>
);

type RenownVersusProps = { cssPath?: string; vs?: VsResult | null; a?: string; b?: string; origin?: string };

export const RenownVersus = ({ cssPath, vs = null, a = "", b = "", origin = "" }: RenownVersusProps) => {
  const ok = vs && !("error" in vs);
  const title = ok ? `@${(vs as Versus).a.login} vs @${(vs as Versus).b.login} — Renown` : "Head to head — Renown";
  const desc = ok ? (vs as Versus).verdict.text : "Compare two devs head to head on renown.";
  const url = `${origin}/vs/${a}/${b}`;
  const image = ok ? `${origin}/vs/${a}/${b}/og.png` : undefined;
  return (
    <html lang="en">
      <Head cssPath={cssPath} title={title} description={desc} canonical={url}
        openGraph={{ title, description: desc, type: "website", url, image, imageAlt: title, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
        twitter={{ card: "summary_large_image", title, description: desc, image, imageAlt: title }} />
      <body>{ok ? <Body vs={vs as Versus} /> : <NotFound who={(vs && "missing" in vs && vs.missing) || ""} />}</body>
    </html>
  );
};
