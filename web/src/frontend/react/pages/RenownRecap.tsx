// Public /recap/:login page — a shareable "your week" summary: renown earned, achievements
// unlocked, level, and the player's pet, with a copyable share link. SSR with recap-specific OG
// tags so a shared link produces the recap card (web/src/backend/recapOg.ts). Deliberately
// LIGHTWEIGHT (no three.js) — the pet renders as the canonical 2D sprite, same as the board page.
import { Head } from "@absolutejs/absolute/react/components";
import { useState } from "react";
import { generate } from "../../../../../core/procgen.ts";
import { spriteToSvg } from "../../../../../core/petSvg.ts";

const petSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>`;
};
const PetSprite = ({ seed, box }: { seed: string; box: number }) => (
  <span style={{ width: box, height: box, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: petSvgHtml(seed, box) }} />
);

type Achievement = { id: string; name: string; tier: string; category: string; at: string | null };
type RecapForUI = {
  login: string; handle: string; avatarSeed: string | null; tier: string; isAi: boolean;
  windowDays: number; attributionDelta: number; verifiedDelta: number; currentScore: number;
  totalLevel: number; petsCount: number; rarestPetSeed: string | null;
  newAchievements: Achievement[]; snapshots: number;
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const TIER_EMOJI: Record<string, string> = { mythic: "🏆", platinum: "💠", gold: "🥇", silver: "🥈", bronze: "🥉", secret: "🔒" };

const Copyable = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* user can select it */ }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <code style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap", padding: "10px 12px", background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 8, fontSize: 12.5 }}>{text}</code>
      <button onClick={onCopy} style={{ padding: "6px 12px", background: copied ? "rgba(134,239,172,.18)" : "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, color: "inherit", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}>{copied ? "✓ Copied" : "Copy link"}</button>
    </div>
  );
};

const RecapNotFound = ({ login }: { login: string }) => (
  <main className="wrap profilePage">
    <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a></header>
    <section className="card" style={{ textAlign: "center" }}>
      <h1>No week to recap for {login}</h1>
      <p className="muted">This person isn't on Renown yet — so there's no week to show.</p>
      <p style={{ marginTop: 16 }}><a href="/">← Browse the leaderboard</a></p>
    </section>
  </main>
);

const RecapBody = ({ recap, origin }: { recap: RecapForUI; origin: string }) => {
  const seed = recap.avatarSeed ?? recap.rarestPetSeed;
  const earned = recap.attributionDelta > 0;
  const shareUrl = `${origin}/recap/${encodeURIComponent(recap.login)}`;
  return (
    <main className="wrap profilePage">
      <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a>  <a href={`/profile/${encodeURIComponent(recap.login)}`} className="muted" style={{ marginLeft: 12 }}>full profile →</a></header>

      <section className="card" style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="muted" style={{ textTransform: "uppercase", letterSpacing: 1, fontSize: 13, fontWeight: 700 }}>Renown · your week</p>
          <h1 style={{ margin: "2px 0 0" }}>@{recap.login}{recap.isAi && <span style={{ fontSize: 14, opacity: 0.7 }}> 🤖</span>}</h1>
          <p className="muted" style={{ marginTop: 2 }}>last {recap.windowDays} days</p>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, color: "#c4b5fd" }}>{earned ? `+${fmt(recap.attributionDelta)}` : fmt(recap.currentScore)}</div>
            <div className="muted" style={{ fontSize: 15, marginTop: 4 }}>{earned ? "renown earned this week" : "total renown — keep shipping"}</div>
          </div>
        </div>
        {seed && (
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <PetSprite seed={seed} box={120} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{recap.tier}</div>
          </div>
        )}
      </section>

      <section className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {recap.verifiedDelta > 0 && <Stat label="score this week" value={`+${fmt(recap.verifiedDelta)}`} />}
          <Stat label="achievements" value={`+${recap.newAchievements.length}`} />
          <Stat label="total level" value={fmt(recap.totalLevel)} />
          <Stat label="1/1 pets" value={fmt(recap.petsCount)} />
        </div>
        {recap.newAchievements.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Unlocked this week</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {recap.newAchievements.slice(0, 12).map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                  <span>{TIER_EMOJI[a.tier] ?? "✦"}</span>
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                  <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{a.category}</span>
                </div>
              ))}
              {recap.newAchievements.length > 12 && <p className="muted" style={{ fontSize: 12 }}>+{recap.newAchievements.length - 12} more</p>}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Share your week</h2>
        <Copyable text={shareUrl} />
        <p style={{ marginTop: 12 }}><img src={`${origin}/recap/${encodeURIComponent(recap.login)}/og.png`} alt="renown weekly recap card" style={{ maxWidth: "100%", borderRadius: 12 }} /></p>
        <p className="muted" style={{ marginTop: 12 }}>Earn your own: <code>npm install -g @absolutejs/renown</code> → <code>renown link</code>.</p>
      </section>
    </main>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div style={{ flex: "1 1 120px", minWidth: 110, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
    <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{value}</div>
  </div>
);

type RenownRecapProps = {
  cssPath?: string;
  recap?: RecapForUI | null;
  login?: string;
  origin?: string;
  shareSnippet?: string;
};

export const RenownRecap = ({ cssPath, recap = null, login = "", origin = "", shareSnippet = "A week of real, meritorious dev work." }: RenownRecapProps) => {
  const who = recap?.login ?? login;
  const fullUrl = `${origin}/recap/${encodeURIComponent(who)}`;
  const title = recap ? `@${recap.login}'s week on Renown` : `${login} — not on Renown yet`;
  const image = recap ? `${origin}/recap/${encodeURIComponent(recap.login)}/og.png` : undefined;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={shareSnippet}
        canonical={fullUrl}
        openGraph={{ title, description: shareSnippet, type: "website", url: fullUrl, image, imageAlt: `${who}'s week on Renown`, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
        twitter={{ card: "summary_large_image", title, description: shareSnippet, image, imageAlt: `${who}'s week on Renown` }}
      />
      <body>
        {recap ? <RecapBody recap={recap} origin={origin} /> : <RecapNotFound login={who} />}
      </body>
    </html>
  );
};
