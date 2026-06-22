// Public /pet/:seed page — a single 1/1 pet's own page. A seed deterministically generates the
// creature (pure, no DB), so any valid seed renders. The pet cards in the VS Code extension (and
// the OG/share links) point here, making every sprite a doorway into renown.
//
// Lightweight like RenownProject — renders the canonical 2D sprite (with a gentle idle bob), the
// creature's name/tier/rarity/traits, and an install CTA. No three.js.
import { Head } from "@absolutejs/absolute/react/components";
import { generate, TIER_RGB, type Tier } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

type RGB = readonly [number, number, number];
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// The hero sprite as an animated SVG string (idle bob via SMIL — declarative, runs everywhere).
const heroSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible"><g>${svg}<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/></g></svg>`;
};

type PetForUI = {
  seed: string; name: string; tier: string; sizeN: number;
  statRarity: number; rarestTrait: string; oneOfOne: boolean; mythicAura: boolean;
  traits: Record<string, string>;
};

type PetOwner = { login: string | null; handle: string; tier: string; isAi: boolean; earnedVia: string | null } | null;

const PetBody = ({ pet, owner, origin }: { pet: PetForUI; owner: PetOwner; origin: string }) => {
  const accent = hex(TIER_RGB[pet.tier as Tier] ?? [160, 160, 180]);
  const pageUrl = `${origin}/pet/${pet.seed}`;
  return (
    <main className="wrap profilePage">
      <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a> <a href="/" className="muted" style={{ marginLeft: 12 }}>← Browse leaderboard</a></header>

      <section className="card" style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0, width: 220, height: 220, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 20, background: "rgba(255,255,255,.04)", border: `2px solid ${accent}66` }}>
          <span dangerouslySetInnerHTML={{ __html: heroSvgHtml(pet.seed, 176) }} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ marginBottom: 8 }}>{pet.name}{pet.oneOfOne && <span style={{ marginLeft: 10, fontSize: 14, color: accent, fontWeight: 800, verticalAlign: "middle" }}>1/1</span>}</h1>
          <p style={{ margin: "0 0 6px" }}>
            <span style={{ display: "inline-block", padding: "3px 12px", borderRadius: 999, background: `${accent}2e`, border: `1px solid ${accent}80`, color: accent, fontWeight: 800 }}>{pet.tier}</span>
            <span className="muted" style={{ marginLeft: 10 }}>size {pet.sizeN} · {pet.oneOfOne ? "the only one" : `1 in ${pet.statRarity.toLocaleString()}`}</span>
          </p>
          <p className="muted" style={{ margin: 0 }}>rarest trait · <strong style={{ color: "inherit" }}>{pet.rarestTrait}</strong>{pet.mythicAura ? " · mythic aura" : ""}</p>
          {owner?.login
            ? <p style={{ margin: "12px 0 0" }}>Owned by <a href={`/profile/${encodeURIComponent(owner.login)}`} style={{ fontWeight: 700, color: accent, textDecoration: "none" }}>@{owner.login}</a>{owner.isAi && <span title="AI participant"> 🤖</span>}{owner.earnedVia && owner.earnedVia.toLowerCase() !== owner.login.toLowerCase() && <span className="muted"> · earned via @{owner.earnedVia}</span>}</p>
            : <p className="muted" style={{ margin: "12px 0 0", fontSize: 13 }}>Unclaimed — this seed isn't in anyone's wild yet.</p>}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Traits</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          {Object.entries(pet.traits).map(([k, v]) => (
            <div key={k} style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>{k}</div>
              <div style={{ fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ textAlign: "center" }}>
        <p className="muted" style={{ marginTop: 0 }}>This pet was procedurally generated from a real commit — every renown pet is a 1/1. Earn your own:</p>
        <p style={{ marginBottom: 6 }}><code>npm install -g @absolutejs/renown</code></p>
        <p className="muted" style={{ fontSize: 13 }}>Then <code>gh auth login</code> and <code>renown link</code> — your commits start hatching pets.</p>
        <p style={{ marginTop: 14, fontSize: 13 }}><a href={pageUrl}>{pageUrl}</a></p>
      </section>
    </main>
  );
};

type RenownPetProps = { cssPath?: string; pet?: PetForUI | null; owner?: PetOwner; origin?: string; shareSnippet?: string };

export const RenownPet = ({ cssPath, pet = null, owner = null, origin = "", shareSnippet }: RenownPetProps) => {
  const an = pet && /^[AEIOU]/.test(pet.tier) ? "an" : "a";
  const title = pet ? `${pet.name} — ${an} ${pet.tier} 1/1 pet on Renown` : "A renown pet";
  const desc = shareSnippet ?? (pet ? `${pet.tier} · size ${pet.sizeN} · ${pet.oneOfOne ? "the only one (1 of 1)" : `1 in ${pet.statRarity.toLocaleString()}`} — a 1/1 pet minted from a real commit.` : "A 1/1 pet on Renown.");
  const fullUrl = pet ? `${origin}/pet/${pet.seed}` : `${origin}/`;
  const image = pet ? `${origin}/pet/${pet.seed}/og.png` : undefined;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={desc}
        canonical={fullUrl}
        openGraph={{ title, description: desc, type: "website", url: fullUrl, image, imageAlt: title, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
        twitter={{ card: "summary_large_image", title, description: desc, image, imageAlt: title }}
      />
      <body>
        {pet ? <PetBody pet={pet} owner={owner} origin={origin} /> : (
          <main className="wrap profilePage"><section className="card"><h1>No such pet</h1><p className="muted">That seed doesn't resolve to a pet.</p><p><a href="/">← Browse the leaderboard</a></p></section></main>
        )}
      </body>
    </html>
  );
};
