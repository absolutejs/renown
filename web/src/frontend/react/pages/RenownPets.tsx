// Collection-first pet workspace. Signed-in players land in their inventory; everyone
// can switch to database-backed discovery with the same search/filter/sort controls.
import { Head } from "@absolutejs/absolute/react/components";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CARD_VARIANTS, COPY_COLORWAYS, COPY_MATERIALS, COPY_MUTATIONS, COPY_PATTERNS, generate, TIER_RGB, type Tier } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";
import { PetBooksWorkspace } from "../components/PetBooksWorkspace";
import { SiteHeader } from "../components/SiteHeader";

type RGB = readonly [number, number, number];
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const petSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible"><g>${svg}<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/></g></svg>`;
};

type GalleryPet = {
  seed: string; login: string | null; handle: string; tier: string; isAi: boolean;
  earnedAt: string | null; name: string; rarityScore: number; size: number;
  species: string; aura: string; oneOfOne: boolean; isAvatar?: boolean; lookId?: string;
  printingId?: string | null; serialNumber?: number | null; printRun?: number | null;
  finish?: string | null; mutation?: string | null; material?: string | null; colorway?: string | null; copyPattern?: string | null; population?: number | null; sizeRank?: number | null;
};
type PetPage = { pets: GalleryPet[]; nextCursor?: string | null; total?: number; sort?: PetSort };
type PetSort = "newest" | "rarest" | "biggest" | "name";
type Workspace = "collection" | "books" | "discover";
type RenownPetsProps = { cssPath?: string; pets?: GalleryPet[]; nextCursor?: string | null; total?: number; origin?: string };

const TIER_OPTIONS = ["all", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
const SPECIES_OPTIONS = ["all", "Slime", "Critter", "Beast", "Construct", "Drake", "Sprite", "Wyrm", "Eldritch", "Celestial"];
const FINISH_OPTIONS = ["all", ...Object.values(CARD_VARIANTS).map((row) => row.finish)];
const MUTATION_OPTIONS = ["all", "mutated", "Iridescent", "Chromatic", "Negative", "Singularity", "Standard"];
const MATERIAL_OPTIONS = ["all", ...COPY_MATERIALS.map((row) => row.value)];
const COLORWAY_OPTIONS = ["all", ...COPY_COLORWAYS.map((row) => row.value)];
const PATTERN_OPTIONS = ["all", ...COPY_PATTERNS.map((row) => row.value)];

const PetTile = ({ pet, owned, onAvatar }: { pet: GalleryPet; owned: boolean; onAvatar: (seed: string) => void }) => {
  const generated = useMemo(() => generate(pet.seed), [pet.seed]);
  const name = pet.name || generated.name;
  const tier = pet.tier || generated.tier;
  const species = pet.species || generated.traits.species;
  const size = pet.size || generated.sizeN;
  const serial = pet.serialNumber ?? generated.card?.serialNumber ?? null;
  const total = pet.printRun ?? generated.card?.printRun ?? null;
  const finish = pet.finish ?? generated.card?.finish ?? tier;
  const mutation = pet.mutation ?? generated.copyTraits?.mutation;
  const material = pet.material ?? generated.copyTraits?.material;
  const copyPattern = pet.copyPattern ?? generated.copyTraits?.copyPattern;
  const accent = hex(TIER_RGB[tier as Tier] ?? [160, 160, 180]);
  return (
    <article className={`collectionPet tier-${tier.toLowerCase()}${pet.isAvatar ? " isAvatar" : ""}`} style={{ "--pet-accent": accent } as CSSProperties}>
      <a className="collectionPetArt" href={`/pet/${encodeURIComponent(pet.seed)}`} title={`${name} — ${tier}`}>
        {pet.isAvatar && <span className="collectionPetStatus">Current avatar</span>}
        <span dangerouslySetInnerHTML={{ __html: petSvgHtml(pet.seed, 112) }} />
      </a>
      <div className="collectionPetBody">
        <div className="collectionPetTitle">
          <a href={`/pet/${encodeURIComponent(pet.seed)}`}>{name}</a>
          <span className="petTierBadge">{tier}</span>
        </div>
        <div className="collectionPetMeta"><strong>{finish}</strong><span>{species}</span><span>size {size}</span></div>
        {(pet.sizeRank === 1 || (serial != null && serial <= 10) || (mutation && mutation !== "Standard") || (material && material !== "Standard") || (copyPattern && copyPattern !== "None")) && <div className="petDistinctions">
          {pet.sizeRank === 1 && <span>Largest known</span>}
          {serial != null && serial <= 10 && <span>Low serial</span>}
          {mutation && mutation !== "Standard" && <span>{mutation} mutation</span>}
          {material && material !== "Standard" && <span>{material}</span>}
          {copyPattern && copyPattern !== "None" && <span>{copyPattern}</span>}
        </div>}
        {!owned && pet.login && <a className="collectionPetOwner" href={`/profile/${encodeURIComponent(pet.login)}`}>@{pet.login}{pet.isAi ? " 🤖" : ""}</a>}
        <div className="collectionPetActions">
          <a className="petAction" href={`/pet/${encodeURIComponent(pet.seed)}`}>View details</a>
          {owned && <a className="petAction" href={`/marketplace?sell=${encodeURIComponent(pet.seed)}`}>Sell</a>}
          {owned && !pet.isAvatar && <button className="petAction primary" onClick={() => onAvatar(pet.seed)}>Set avatar</button>}
        </div>
      </div>
    </article>
  );
};

export const RenownPets = ({ cssPath, pets: initialPets = [], nextCursor: initialCursor = null, total: initialTotal, origin = "" }: RenownPetsProps) => {
  const [workspace, setWorkspace] = useState<Workspace>("discover");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [pets, setPets] = useState(initialPets);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [total, setTotal] = useState(initialTotal ?? initialPets.length);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("all");
  const [species, setSpecies] = useState("all");
  const [finish, setFinish] = useState("all");
  const [mutation, setMutation] = useState("all");
  const [material, setMaterial] = useState("all");
  const [colorway, setColorway] = useState("all");
  const [pattern, setPattern] = useState("all");
  const [sort, setSort] = useState<PetSort>("newest");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const endpoint = workspace === "collection" ? "/api/account/pets" : "/api/pets";
  const load = async (append = false, signal?: AbortSignal) => {
    if (append && !nextCursor) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "24", sort });
    if (q.trim()) params.set("q", q.trim());
    if (tier !== "all") params.set("tier", tier);
    if (species !== "all") params.set("species", species);
    if (finish !== "all") params.set("finish", finish);
    if (mutation !== "all") params.set("mutation", mutation);
    if (material !== "all") params.set("material", material);
    if (colorway !== "all") params.set("colorway", colorway);
    if (pattern !== "all") params.set("pattern", pattern);
    if (append && nextCursor) params.set("cursor", nextCursor);
    try {
      const response = await fetch(`${endpoint}?${params}`, { signal });
      if (response.status === 401 && workspace === "collection") {
        setSignedIn(false); setWorkspace("discover"); return;
      }
      if (!response.ok) throw new Error(`request failed (${response.status})`);
      const page = await response.json() as PetPage;
      if (workspace === "collection") setSignedIn(true);
      setPets((current) => append ? [...current, ...(page.pets ?? [])] : (page.pets ?? []));
      setNextCursor(page.nextCursor ?? null);
      setTotal(page.total ?? page.pets?.length ?? 0);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("Couldn’t load pets. Try again.");
    } finally { if (!signal?.aborted) setLoading(false); }
  };

  // Probe the protected collection once. A valid session promotes My collection to the
  // default workspace; logged-out visitors keep the server-rendered discovery page.
  useEffect(() => {
    const controller = new AbortController();
    const opensBook = new URLSearchParams(window.location.search).has("book");
    if (opensBook) setWorkspace("books");
    fetch("/oauth2/status", { signal: controller.signal }).then((response) => response.json()).then(async (status: { user?: unknown }) => {
      if (!status.user) { setSignedIn(false); return; }
      const response = await fetch("/api/account/pets?limit=24&sort=newest", { signal: controller.signal });
      if (!response.ok) return;
      const page = await response.json() as PetPage;
      setSignedIn(true); setWorkspace(opensBook ? "books" : "collection"); setPets(page.pets ?? []);
      setNextCursor(page.nextCursor ?? null); setTotal(page.total ?? 0);
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (workspace === "books" || signedIn === null || (workspace === "collection" && !signedIn)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(false, controller.signal); }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, q, tier, species, finish, mutation, material, colorway, pattern, sort, signedIn]);

  const setAvatar = async (seed: string) => {
    const response = await fetch("/api/account/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed }) });
    if (!response.ok) { setMessage("Couldn’t update your avatar."); return; }
    setPets((current) => current.map((pet) => ({ ...pet, isAvatar: pet.seed === seed })));
    setMessage("Avatar updated.");
  };
  const resetFilters = () => { setQ(""); setTier("all"); setSpecies("all"); setFinish("all"); setMutation("all"); setMaterial("all"); setColorway("all"); setPattern("all"); setSort("newest"); };
  const title = workspace === "collection" ? "My pet collection — Renown" : workspace === "books" ? "Collector books — Renown" : "Discover pets — Renown";
  const desc = "Search, filter, sort, and manage unique pets earned through real development work.";
  const url = `${origin}/pets`;

  return (
    <html lang="en">
      <Head cssPath={cssPath} title={title} description={desc} canonical={url}
        openGraph={{ title, description: desc, type: "website", url, siteName: "Renown" }}
        twitter={{ card: "summary", title, description: desc }} />
      <body>
        <main className="wrap collectionPage">
          <SiteHeader current="pets" />
          <nav className="collectionNav collectionWorkspaceNav" aria-label="Collection workspace">
              {signedIn && <button className={workspace === "collection" ? "on" : ""} onClick={() => setWorkspace("collection")}>My collection</button>}
              <button className={workspace === "books" ? "on" : ""} onClick={() => setWorkspace("books")}>Books</button>
              <button className={workspace === "discover" ? "on" : ""} onClick={() => setWorkspace("discover")}>Discover</button>
              {signedIn ? <a href="/?view=account">Account settings</a> : <a href="/">Log in</a>}
          </nav>

          {message && <div className="collectionNotice"><span>{message}</span><button onClick={() => setMessage(null)}>Dismiss</button></div>}
          {workspace === "books" ? <PetBooksWorkspace signedIn={signedIn} onMessage={setMessage} /> : <>

          <section className="collectionHero">
            <div>
              <span className="collectionEyebrow">{workspace === "collection" ? "YOUR INVENTORY" : "THE RENOWN ARCHIVE"}</span>
              <h1>{workspace === "collection" ? "My collection" : "Discover pets"}</h1>
              <p>{workspace === "collection"
                ? "Every pet you’ve earned, in one place. Find favorites, inspect traits, and choose the face you show across Renown."
                : "Explore pets earned by developers across Renown. Search owners and seeds, or hunt by species and rarity."}</p>
            </div>
            <div className="collectionCount"><strong>{total.toLocaleString()}</strong><span>{workspace === "collection" ? "pets owned" : "pets found"}</span></div>
          </section>

          <section className="collectionTools" aria-label="Collection filters">
            <label className="collectionSearch"><span>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={workspace === "collection" ? "Name or commit seed…" : "Name, owner, or commit seed…"} /></label>
            <label><span>Tier</span><select value={tier} onChange={(e) => setTier(e.target.value)}>{TIER_OPTIONS.map((value) => <option value={value} key={value}>{value === "all" ? "All tiers" : value}</option>)}</select></label>
            <label><span>Species</span><select value={species} onChange={(e) => setSpecies(e.target.value)}>{SPECIES_OPTIONS.map((value) => <option value={value} key={value}>{value === "all" ? "All species" : value}</option>)}</select></label>
            <label><span>Finish</span><select value={finish} onChange={(e) => setFinish(e.target.value)}>{FINISH_OPTIONS.map((value) => <option value={value} key={value}>{value === "all" ? "All finishes" : value}</option>)}</select></label>
            <label><span>Mutation</span><select value={mutation} onChange={(e) => setMutation(e.target.value)}>{MUTATION_OPTIONS.map((value) => <option value={value} key={value}>{value === "all" ? "All mutations" : value === "mutated" ? "Any special mutation" : value}</option>)}</select></label>
            <label><span>Material</span><select value={material} onChange={(e) => setMaterial(e.target.value)}>{MATERIAL_OPTIONS.map((value) => <option value={value} key={value}>{value === "all" ? "All materials" : value}</option>)}</select></label>
            <label><span>Colorway</span><select value={colorway} onChange={(e) => setColorway(e.target.value)}>{COLORWAY_OPTIONS.map((value) => <option value={value} key={value}>{value === "all" ? "All colorways" : value}</option>)}</select></label>
            <label><span>Surface</span><select value={pattern} onChange={(e) => setPattern(e.target.value)}>{PATTERN_OPTIONS.map((value) => <option value={value} key={value}>{value === "all" ? "All patterns" : value}</option>)}</select></label>
            <label><span>Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value as PetSort)}><option value="newest">Newest</option><option value="rarest">Rarest</option><option value="biggest">Biggest</option><option value="name">Name</option></select></label>
            {(q || tier !== "all" || species !== "all" || finish !== "all" || mutation !== "all" || material !== "all" || colorway !== "all" || pattern !== "all" || sort !== "newest") && <button className="clearFilters" onClick={resetFilters}>Clear filters</button>}
          </section>

          <details className="card" id="chase" style={{ marginBottom: 18 }}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Published chase odds and fixed supplies</summary>
            <p className="muted">These odds apply to every pull. Every subject has every finish printing, including chase printings nobody has discovered yet.</p>
            <div style={{ overflowX: "auto" }}><table className="atable"><thead><tr><th>Finish</th><th>Tier</th><th>Probability</th><th>Odds</th><th>Print run</th></tr></thead><tbody>
              {Object.values(CARD_VARIANTS).map((row) => <tr key={row.finish}><td><strong>{row.finish}</strong></td><td>{row.tier}</td><td>{row.probability >= .01 ? `${(row.probability * 100).toFixed(row.probability >= .1 ? 0 : 2)}%` : `${(row.probability * 100).toFixed(4)}%`}</td><td>1 in {row.pullOdds.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td>/{row.printRun.toLocaleString()}</td></tr>)}
            </tbody></table></div>
            <h3>Special copy mutations</h3>
            <p className="muted">This independent shiny-style roll happens after finish selection.</p>
            <div style={{ overflowX: "auto" }}><table className="atable"><thead><tr><th>Mutation</th><th>Probability</th><th>Odds</th></tr></thead><tbody>
              {[...COPY_MUTATIONS].reverse().map((row) => <tr key={row.value}><td><strong>{row.value}</strong></td><td>{row.probability >= .01 ? `${(row.probability * 100).toFixed(row.probability >= .1 ? 0 : 2)}%` : `${(row.probability * 100).toFixed(4)}%`}</td><td>{row.probability >= 1 ? "Every copy" : `1 in ${(1 / row.probability).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</td></tr>)}
            </tbody></table></div>
            <h3>Materials, surface patterns, and colorways</h3>
            <p className="muted">These are independent disclosed rolls. Their probabilities multiply, so an exact favorite combination can be dramatically rarer than any one trait.</p>
            {[{ title: "Material", rows: COPY_MATERIALS }, { title: "Surface pattern", rows: COPY_PATTERNS }, { title: "Colorway", rows: COPY_COLORWAYS }].map((group) => <div key={group.title} style={{ overflowX: "auto", marginTop: 14 }}><h4>{group.title}</h4><table className="atable"><thead><tr><th>{group.title}</th><th>Probability</th><th>Odds</th></tr></thead><tbody>{group.rows.map((row) => <tr key={row.value}><td><strong>{row.value}</strong></td><td>{row.probability >= .01 ? `${(row.probability * 100).toFixed(row.probability >= .1 ? 0 : 2)}%` : `${(row.probability * 100).toFixed(4)}%`}</td><td>1 in {(1 / row.probability).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>)}</tbody></table></div>)}
          </details>

          <div className="collectionResultsHeader"><span>{loading && pets.length === 0 ? "Loading…" : `Showing ${pets.length.toLocaleString()} of ${total.toLocaleString()}`}</span>{workspace === "collection" && <span>Choose “Set avatar” to use a pet across Renown.</span>}</div>

          {pets.length > 0 ? <section className={`collectionGrid${loading ? " isLoading" : ""}`}>
            {pets.map((pet) => <PetTile key={pet.seed} pet={pet} owned={workspace === "collection"} onAvatar={(seed) => void setAvatar(seed)} />)}
          </section> : !loading && <section className="collectionEmpty"><h2>No pets match</h2><p>Try clearing a filter or searching for something broader.</p><button className="btn ghost" onClick={resetFilters}>Clear filters</button></section>}

          {nextCursor && <div className="collectionMore"><button className="btn ghost" disabled={loading} onClick={() => void load(true)}>{loading ? "Loading…" : `Load more · ${Math.max(0, total - pets.length).toLocaleString()} remaining`}</button></div>}
          </>}
        </main>
      </body>
    </html>
  );
};
