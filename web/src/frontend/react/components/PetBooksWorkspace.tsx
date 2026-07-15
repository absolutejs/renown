import { useEffect, useMemo, useState } from "react";
import { generate, TIER_RGB, type Tier } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

type Parallel = { variant: string; finish: string; tier: string; printRun: number; ownedCount: number; globallyDiscovered: boolean };
type OfficialSlot = { slotNumber: number; revealed: boolean; name?: string; ownedSeed?: string | null; parallels: Parallel[] };
type OfficialBook = { id: string; name: string; description: string; releaseYear: number; coverStyle: string; subjectCount: number; subjectsOwned: number; parallelsOwned: number; totalParallels: number; slots: OfficialSlot[] };
type PetOption = { seed: string; name: string; tier: string; finish: string | null; mutation: string | null; serialNumber: number | null; printRun: number | null };
type PersonalSlot = { position: number; target: { kind: string; label: string; value?: string }; note: string; pet: (PetOption & { size: number }) | null };
type PersonalBook = { id: string; name: string; description: string; visibility: string; coverStyle: string; filled: number; slots: PersonalSlot[]; owner?: string | null };
type Payload = { official: OfficialBook[]; personal: PersonalBook[] };

const petSvg = (seed: string, box = 100) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>`;
};
const pct = (have: number, total: number) => total > 0 ? Math.round((have / total) * 100) : 0;
const bookClass = (cover: string) => `petBookCover cover-${cover}`;

const OfficialBinder = ({ book, onBack }: { book: OfficialBook; onBack: () => void }) => <section className="petBookOpen">
  <div className="petBookOpenHead">
    <button className="petBookBack" onClick={onBack}>← Book shelf</button>
    <div><span className="collectionEyebrow">OFFICIAL SET · {book.releaseYear}</span><h2>{book.name}</h2><p>{book.description}</p></div>
    <div className="petBookCompletion"><strong>{book.subjectsOwned}/{book.subjectCount}</strong><span>subjects revealed</span><small>{book.parallelsOwned}/{book.totalParallels} parallels</small></div>
  </div>
  <div className="petBookLegend"><span><i className="isOwned" /> Owned</span><span><i className="isDiscovered" /> Discovered somewhere</span><span><i /> Still hidden</span></div>
  <div className="officialBinderGrid">
    {book.slots.map((slot) => <article className={`officialBinderSlot${slot.revealed ? " isRevealed" : ""}`} key={slot.slotNumber}>
      <div className="binderPocket">
        <span className="binderSlotNumber">#{String(slot.slotNumber).padStart(3, "0")}</span>
        {slot.revealed && slot.ownedSeed
          ? <a href={`/pet/${encodeURIComponent(slot.ownedSeed)}`} dangerouslySetInnerHTML={{ __html: petSvg(slot.ownedSeed) }} />
          : <div className="hiddenPetSilhouette" aria-label="Hidden subject">?</div>}
      </div>
      <strong>{slot.revealed ? slot.name : "Unknown subject"}</strong>
      <span className="binderHint">{slot.revealed ? "Subject revealed" : slot.parallels.some((p) => p.globallyDiscovered) ? "Something here has been found" : "No public discovery"}</span>
      <div className="parallelRow">{slot.parallels.map((parallel) => <i key={parallel.variant} className={parallel.ownedCount ? "isOwned" : parallel.globallyDiscovered ? "isDiscovered" : ""} title={`${parallel.finish}: ${parallel.ownedCount ? `${parallel.ownedCount} owned` : parallel.globallyDiscovered ? "discovered globally" : "undiscovered"}`} />)}</div>
    </article>)}
  </div>
</section>;

const PersonalBinder = ({ book, options, onBack, refresh, message }: { book: PersonalBook; options: PetOption[]; onBack: () => void; refresh: () => Promise<void>; message: (value: string) => void }) => {
  const [petSeed, setPetSeed] = useState("");
  const [kind, setKind] = useState("freeform");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = !book.owner;
  const add = async (body: unknown) => {
    setBusy(true);
    const response = await fetch(`/api/account/pet-books/${encodeURIComponent(book.id)}/slots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) message(await response.text()); else { setPetSeed(""); setLabel(""); await refresh(); }
    setBusy(false);
  };
  const remove = async (position: number) => {
    await fetch(`/api/account/pet-books/${encodeURIComponent(book.id)}/slots/${position}`, { method: "DELETE" });
    await refresh();
  };
  const share = async () => {
    const url = `${window.location.origin}/pets?book=${encodeURIComponent(book.id)}`;
    await navigator.clipboard.writeText(url);
    message("Collector book link copied.");
  };
  return <section className="petBookOpen personalBinder">
    <div className="petBookOpenHead"><button className="petBookBack" onClick={onBack}>← Book shelf</button><div><span className="collectionEyebrow">PERSONAL COLLECTOR BOOK{book.owner ? ` · @${book.owner}` : ""}</span><h2>{book.name}</h2><p>{book.description || "A collection with your rules."}</p>{book.visibility !== "private" && <button className="shareBook" onClick={() => void share()}>Copy share link</button>}</div><div className="petBookCompletion"><strong>{book.filled}/{book.slots.length}</strong><span>slots filled</span><small>{book.visibility}</small></div></div>
    <div className="personalBinderGrid">
      {book.slots.map((slot) => <article className={`personalBinderSlot${slot.pet ? " isFilled" : ""}`} key={slot.position}>
        <span className="binderSlotNumber">Pocket {slot.position}</span>
        {slot.pet ? <a className="personalPetArt" href={`/pet/${encodeURIComponent(slot.pet.seed)}`} dangerouslySetInnerHTML={{ __html: petSvg(slot.pet.seed, 112) }} /> : <div className="emptyBinderPocket">+</div>}
        <strong>{slot.pet?.name ?? slot.target.label}</strong>
        <span className="binderHint">{slot.pet ? `${slot.pet.finish ?? slot.pet.tier} · ${slot.pet.mutation ?? "Standard"}` : `${slot.target.kind}${slot.target.value ? ` · ${slot.target.value}` : ""}`}</span>
        {editable && <button className="binderRemove" onClick={() => void remove(slot.position)}>Remove</button>}
      </article>)}
      {book.slots.length === 0 && <div className="personalBinderEmpty"><strong>This binder has fresh pages.</strong><span>Add owned copies or define the things you want to chase.</span></div>}
    </div>
    {editable && <div className="binderBuilder">
      <div><h3>Place an owned copy</h3><p className="muted">The copy stays yours; this is a binder reference, ready for future trades.</p><select value={petSeed} onChange={(event) => setPetSeed(event.target.value)}><option value="">Choose one of your pets…</option>{options.map((pet) => <option value={pet.seed} key={pet.seed}>{pet.name} · {pet.finish ?? pet.tier}{pet.mutation && pet.mutation !== "Standard" ? ` · ${pet.mutation}` : ""}</option>)}</select><button className="btn solid" disabled={!petSeed || busy} onClick={() => void add({ petSeed })}>Add copy</button></div>
      <div><h3>Create an empty chase pocket</h3><p className="muted">Define a target even when no matching copy exists yet.</p><div className="binderBuilderRow"><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="freeform">Anything</option><option value="tier">Tier</option><option value="finish">Finish</option><option value="mutation">Mutation</option><option value="species">Species</option><option value="serial">Serial</option><option value="size">Size record</option></select><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Largest Celestial" /></div><button className="btn ghost" disabled={!label.trim() || busy} onClick={() => void add({ target: { kind, label, value: label } })}>Add chase slot</button></div>
    </div>}
  </section>;
};

export const PetBooksWorkspace = ({ signedIn, onMessage }: { signedIn: boolean | null; onMessage: (value: string) => void }) => {
  const [payload, setPayload] = useState<Payload>({ official: [], personal: [] });
  const [options, setOptions] = useState<PetOption[]>([]);
  const [active, setActive] = useState<{ type: "official" | "personal"; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [starter, setStarter] = useState("blank");
  const [coverStyle, setCoverStyle] = useState("midnight");
  const [visibility, setVisibility] = useState("private");
  const refresh = async () => {
    setLoading(true);
    const response = signedIn ? await fetch("/api/account/pet-books") : await fetch("/api/pet-sets");
    if (response.ok) {
      const data = await response.json();
      const nextPayload: Payload = Array.isArray(data) ? { official: data, personal: [] } : data as Payload;
      const sharedId = new URLSearchParams(window.location.search).get("book");
      if (sharedId && !nextPayload.personal.some((book) => book.id === sharedId)) {
        const sharedResponse = await fetch(`/api/pet-books/${encodeURIComponent(sharedId)}`);
        if (sharedResponse.ok) nextPayload.personal.push(await sharedResponse.json() as PersonalBook);
      }
      setPayload(nextPayload);
      if (sharedId && nextPayload.personal.some((book) => book.id === sharedId)) setActive({ type: "personal", id: sharedId });
    }
    if (signedIn && options.length === 0) {
      const optionResponse = await fetch("/api/account/pet-books/options");
      if (optionResponse.ok) setOptions(((await optionResponse.json()) as { pets: PetOption[] }).pets);
    }
    setLoading(false);
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [signedIn]);
  const activeOfficial = useMemo(() => active?.type === "official" ? payload.official.find((book) => book.id === active.id) : null, [active, payload.official]);
  const activePersonal = useMemo(() => active?.type === "personal" ? payload.personal.find((book) => book.id === active.id) : null, [active, payload.personal]);
  const create = async () => {
    const response = await fetch("/api/account/pet-books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, starter, coverStyle, visibility }) });
    if (!response.ok) { onMessage(await response.text()); return; }
    const result = await response.json() as { id: string };
    setName(""); setDescription(""); setCreating(false); await refresh(); setActive({ type: "personal", id: result.id });
  };
  const deleteBook = async (id: string) => {
    if (!window.confirm("Delete this collector book? Your pets remain untouched.")) return;
    await fetch(`/api/account/pet-books/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  };
  if (activeOfficial) return <OfficialBinder book={activeOfficial} onBack={() => setActive(null)} />;
  if (activePersonal) return <PersonalBinder book={activePersonal} options={options} onBack={() => setActive(null)} refresh={refresh} message={onMessage} />;
  return <>
    <section className="collectionHero petBooksHero"><div><span className="collectionEyebrow">THE BINDER SHELF</span><h1>Collector books</h1><p>Official sets hide their secrets until you own them. Personal binders let you decide what matters: a complete parallel rainbow, every mutation, low serials, size records, or a collection nobody else thought to chase.</p></div><div className="collectionCount"><strong>{payload.official.length + payload.personal.length}</strong><span>books on shelf</span></div></section>
    {loading ? <section className="collectionEmpty"><h2>Opening the vault…</h2></section> : <>
      <section className="bookShelfSection"><div className="bookShelfHeading"><div><span className="collectionEyebrow">PUBLISHED BY RENOWN</span><h2>Official set books</h2></div><p>Numbered manifests are permanent. Empty slots prove a chase exists without spoiling the subject.</p></div><div className="petBookShelf">{payload.official.map((book) => <button className={bookClass(book.coverStyle)} onClick={() => setActive({ type: "official", id: book.id })} key={book.id}><span className="bookFoil">OFFICIAL SET</span><strong>{book.name}</strong><small>{book.releaseYear} · {book.subjectCount} subjects</small><div className="bookProgress"><i style={{ width: `${pct(book.subjectsOwned, book.subjectCount)}%` }} /><span>{book.subjectsOwned}/{book.subjectCount} revealed</span></div></button>)}</div></section>
      <section className="bookShelfSection personalShelf"><div className="bookShelfHeading"><div><span className="collectionEyebrow">YOUR RULES</span><h2>Personal binders</h2></div>{signedIn ? <button className="btn solid" onClick={() => setCreating((value) => !value)}>{creating ? "Close builder" : "Create a book"}</button> : <a className="btn solid" href="/">Log in to make books</a>}</div>
        {creating && <div className="createBookPanel"><label><span>Book name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="My impossible chase" /></label><label><span>Start with</span><select value={starter} onChange={(event) => setStarter(event.target.value)}><option value="blank">Blank pages</option><option value="finishes">Seven-finish rainbow</option><option value="mutations">Mutation chase</option><option value="tiers">One of every tier</option><option value="species">Species dex</option></select></label><label><span>Cover</span><select value={coverStyle} onChange={(event) => setCoverStyle(event.target.value)}><option value="midnight">Midnight</option><option value="holo">Holographic</option><option value="archive">Archive leather</option><option value="neon">Neon</option><option value="field">Field notes</option><option value="rose">Rose</option></select></label><label><span>Sharing</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted link</option><option value="public">Public showcase</option></select></label><label className="bookDescription"><span>What are you chasing?</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="The story behind this collection…" /></label><button className="btn solid" disabled={!name.trim()} onClick={() => void create()}>Bind this book</button></div>}
        {payload.personal.length ? <div className="petBookShelf personalBooks">{payload.personal.map((book) => <div className="personalBookWrap" key={book.id}><button className={bookClass(book.coverStyle)} onClick={() => setActive({ type: "personal", id: book.id })}><span className="bookFoil">PERSONAL BINDER</span><strong>{book.name}</strong><small>{book.filled}/{book.slots.length} pockets filled</small><div className="bookProgress"><i style={{ width: `${pct(book.filled, book.slots.length)}%` }} /><span>{book.description || "Your own collecting rules"}</span></div></button><button className="deleteBook" onClick={() => void deleteBook(book.id)}>Delete</button></div>)}</div> : <div className="personalBinderEmpty"><strong>No personal books yet.</strong><span>Start blank or use a chase template, then make it weird.</span></div>}
      </section>
    </>}
  </>;
};
