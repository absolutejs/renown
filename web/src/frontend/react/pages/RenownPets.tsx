// Public /pets gallery — the latest 1/1 pets minted across renown, each a doorway to its own
// /pet/:seed page and its owner's profile. Lightweight (2D canonical sprites, no three.js), a
// discovery surface that shows the game is alive.
import { Head } from "@absolutejs/absolute/react/components";
import { useState } from "react";
import { generate, TIER_RGB, type Tier } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

type RGB = readonly [number, number, number];
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const petSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible"><g>${svg}<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/></g></svg>`;
};

type GalleryPet = { seed: string; login: string | null; handle: string; tier: string; isAi: boolean; earnedAt: string | null };
type GalleryMode = "latest" | "owners";

const PetTile = ({ pet }: { pet: GalleryPet }) => {
  const c = generate(pet.seed);
  const accent = hex(TIER_RGB[pet.tier as Tier] ?? [160, 160, 180]);
  return (
    <div style={{ display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", background: `${accent}14`, border: `1px solid ${accent}55` }}>
      <a href={`/pet/${pet.seed}`} title={`${c.name} — ${pet.tier}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 132, textDecoration: "none" }}>
        <span dangerouslySetInnerHTML={{ __html: petSvgHtml(pet.seed, 104) }} />
      </a>
      <div style={{ padding: "8px 10px 10px", textAlign: "center" }}>
        <a href={`/pet/${pet.seed}`} style={{ display: "block", fontWeight: 700, fontSize: 13, color: "inherit", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</a>
        <div style={{ fontSize: 11, color: accent, fontWeight: 700 }}>{pet.tier}{c.oneOfOne ? " · 1/1" : ""}</div>
        {pet.login && <a href={`/profile/${encodeURIComponent(pet.login)}`} className="muted" style={{ fontSize: 11, textDecoration: "none" }}>@{pet.login}{pet.isAi ? " 🤖" : ""}</a>}
        {pet.earnedAt && <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{new Date(pet.earnedAt).toLocaleDateString()}</div>}
      </div>
    </div>
  );
};

type RenownPetsProps = { cssPath?: string; pets?: GalleryPet[]; nextCursor?: string | null; mode?: GalleryMode; origin?: string };

export const RenownPets = ({ cssPath, pets: initialPets = [], nextCursor: initialCursor = null, mode = "latest", origin = "" }: RenownPetsProps) => {
  const [pets, setPets] = useState(initialPets);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ mode, limit: "24", cursor: nextCursor });
      const response = await fetch(`/api/pets?${params}`);
      if (!response.ok) return;
      const page = await response.json() as { pets?: GalleryPet[]; nextCursor?: string | null };
      setPets((current) => [...current, ...(page.pets ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } finally { setLoading(false); }
  };
  const title = "Pet gallery — the latest 1/1s on Renown";
  const desc = "Browse the freshest 1/1 pets minted from real commits across renown. Each one is unique — procedurally generated from the commit that earned it.";
  const url = `${origin}/pets`;
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
        <main className="wrap profilePage">
          <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a> <a href="/" className="muted" style={{ marginLeft: 12 }}>← Leaderboard</a></header>
          <section className="card">
            <h1 style={{ marginBottom: 4 }}>Pet gallery</h1>
            <p className="muted">Every pet is procedurally generated from a real commit, so no two are alike. Browse the true mint stream or switch to one recent pet per owner for wider discovery.</p>
            <nav className="audienceTabs" aria-label="Pet gallery view" style={{ marginTop: 12 }}>
              <a className={mode === "latest" ? "on" : ""} href="/pets">Latest pets</a>
              <a className={mode === "owners" ? "on" : ""} href="/pets?mode=owners">Recent owners</a>
            </nav>
            {pets.length === 0
              ? <p className="muted" style={{ marginTop: 16 }}>No pets yet. <code>npm install -g @absolutejs/renown</code> → <code>renown link</code> and start hatching.</p>
              : (
                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                  {pets.map((p) => <PetTile key={p.seed} pet={p} />)}
                </div>
              )}
            {nextCursor && (
              <div className="cta" style={{ marginTop: 18 }}>
                <button className="btn ghost" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more pets"}</button>
              </div>
            )}
          </section>
        </main>
      </body>
    </html>
  );
};
