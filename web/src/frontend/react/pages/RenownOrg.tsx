// Public /org/:owner page — a whole GitHub org's renown: its top repos and its top contributors
// across all of them, plus an embeddable org README badge. The distribution surface one level up
// from /project: an org adopts renown → every repo (and contributor) is discoverable from here.
// Lightweight (no three.js); contributor pets render as the canonical 2D sprite.
import { Head } from "@absolutejs/absolute/react/components";
import { SiteHeader } from "../components/SiteHeader";
import { useState } from "react";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

const petSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>`;
};
const PetSprite = ({ seed, box, href }: { seed: string; box: number; href?: string }) => {
  const sprite = <span style={{ width: box, height: box, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: petSvgHtml(seed, box) }} />;
  return href ? <a href={href} title="Open this pet's page" style={{ display: "inline-flex" }}>{sprite}</a> : sprite;
};

type Repo = { key: string; repo: string; name: string; stars: number; oss: boolean; xp: number; devs: number; verified: boolean };
type Contributor = { login: string; avatarSeed: string | null; isAi: boolean; tier: string; xp: number; repos: number; verified: boolean };
type OrgForUI = {
  owner: string;
  repos: Repo[]; contributors: Contributor[]; topContributor: Contributor | null;
  totals: { repos: number; devs: number; xp: number; verifiedDevs: number };
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const Check = () => <span title="GitHub-verified via CI" style={{ color: "#86efac", fontSize: 12 }}> ✓</span>;

const Copyable = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* select it */ } };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <code style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap", padding: "10px 12px", background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 8, fontSize: 12.5 }}>{text}</code>
      <button onClick={onCopy} style={{ padding: "6px 12px", background: copied ? "rgba(134,239,172,.18)" : "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, color: "inherit", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}>{copied ? "✓ Copied" : "Copy"}</button>
    </div>
  );
};

const OrgNotFound = ({ owner }: { owner: string }) => (
  <main className="wrap profilePage">
    <SiteHeader back={{ href: "/leaderboard", label: "Back to leaderboard" }} />
    <section className="card" style={{ textAlign: "center" }}>
      <h1>{owner} isn't on Renown yet</h1>
      <p className="muted">No one tracking a repo under <code>{owner}/</code> with renown has a verified contribution yet. Be the first.</p>
    </section>
  </main>
);

const OrgBody = ({ org, origin }: { org: OrgForUI; origin: string }) => {
  const pageUrl = `${origin}/org/${org.owner}`;
  const badgeMd = `[![renown](${origin}/org/${org.owner}/badge.svg)](${pageUrl})`;
  return (
    <main className="wrap profilePage">
      <SiteHeader back={{ href: "/leaderboard", label: "Back to leaderboard" }} />

      <section className="card" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ marginBottom: 4 }}>{org.owner}</h1>
          <p className="muted">{fmt(org.totals.repos)} repo{org.totals.repos === 1 ? "" : "s"} · {fmt(org.totals.devs)} dev{org.totals.devs === 1 ? "" : "s"} earning renown · {fmt(org.totals.xp)} renown</p>
        </div>
        {org.topContributor?.avatarSeed && (
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <PetSprite seed={org.topContributor.avatarSeed} box={96} href={`/pet/${encodeURIComponent(org.topContributor.avatarSeed)}`} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>top · @{org.topContributor.login}</div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ margin: 0 }}>Top contributors <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· across {org.owner}</span></h2>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {org.contributors.map((c, i) => (
            <a key={c.login} href={`/profile/${encodeURIComponent(c.login)}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
              <span style={{ width: 28, textAlign: "right", fontWeight: 700, opacity: 0.8 }}>{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
              {c.avatarSeed && <PetSprite seed={c.avatarSeed} box={40} />}
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{c.login}{c.verified && <Check />}{c.isAi && <span style={{ fontSize: 11, opacity: 0.7 }}> 🤖</span>}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{fmt(c.xp)}</span>
              <span className="muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, minWidth: 70, textAlign: "right" }}>{c.repos} repo{c.repos === 1 ? "" : "s"}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ margin: 0 }}>Repos <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· by renown</span></h2>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {org.repos.map((r) => (
            <a key={r.key} href={`/project/${r.key}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.repo}{r.verified && <Check />}{r.oss && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · OSS</span>}{r.stars > 0 && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · ★ {fmt(r.stars)}</span>}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{fmt(r.xp)}</span>
              <span className="muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, minWidth: 70, textAlign: "right" }}>{r.devs} dev{r.devs === 1 ? "" : "s"}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Add this badge to your org README</h2>
        <p className="muted hint">Drop it in your org's profile README or a flagship repo — it links here. Markdown:</p>
        <div style={{ marginTop: 8 }}><Copyable text={badgeMd} /></div>
        <p style={{ marginTop: 12 }}><img src={`${origin}/org/${org.owner}/badge.svg`} alt="renown org badge preview" /></p>
        <p className="muted" style={{ marginTop: 12 }}>Contributors verify their repos with <code>bun add -g @absolutejs/renown</code> → <code>renown link</code>, or the renown GitHub Action.</p>
      </section>
    </main>
  );
};

type RenownOrgProps = { cssPath?: string; org?: OrgForUI | null; owner?: string; origin?: string; shareSnippet?: string };

export const RenownOrg = ({ cssPath, org = null, owner = "", origin = "", shareSnippet = "An org's collective renown for real dev work." }: RenownOrgProps) => {
  const who = org?.owner ?? owner;
  const fullUrl = `${origin}/org/${who}`;
  const title = org ? `${org.owner} on Renown · ${org.totals.repos} repos, ${fmt(org.totals.xp)} renown` : `${owner} — not on Renown yet`;
  const image = org ? `${origin}/org/${org.owner}/og.png` : undefined;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={shareSnippet}
        canonical={fullUrl}
        openGraph={{ title, description: shareSnippet, type: "website", url: fullUrl, image, imageAlt: `${who} on Renown`, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
        twitter={{ card: "summary_large_image", title, description: shareSnippet, image, imageAlt: `${who} on Renown` }}
      />
      <body>
        {org ? <OrgBody org={org} origin={origin} /> : <OrgNotFound owner={who} />}
      </body>
    </html>
  );
};
