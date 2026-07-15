import { Head } from "@absolutejs/absolute/react/components";
import { type FormEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addPadVoice, chimeVoiceFor, isSoundOn, playBell, playChime, playGong, playSadTrombone, setSoundOn, startAmbientPad, stopAmbientPad } from "../../audio";
import { MenagerieCanvas } from "../components/MenagerieCanvas";
import { GhostAvatar, SinglePet, SpotlightView, SummonCinematic } from "../components/PetViewer";
import { ProfileModal } from "../components/ProfileModal";
import { SiteHeader, type SiteSection } from "../components/SiteHeader";
import { DEFAULT_PET_LOOK_ID, isPetLookId, PET_LOOKS, type PetLookId } from "../../../shared/petLooks.ts";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";
import { SKILLS } from "../../../shared/skills.ts";
import { subscribeSync } from "../../syncClient";

type Tier = "free" | "supporter" | "pro";
type PetLookMap = Record<string, PetLookId>;
type SummonPet = { seed: string; lookId: PetLookId; serialNumber?: number; printRun?: number };
type Entry = { id?: string; name: string; login?: string; score?: number; weekXp?: number; baseScore?: number; meritScore?: number; level: number; totalLevel?: number; xp: number; streak: number; ach: number; tier?: Tier; isAi?: boolean; aiAttestation?: AiAttestation | null; petsCount?: number; rarestPetScore?: number; rarestPetSeed?: string | null; biggestPetSize?: number; biggestPetSeed?: string | null; avatarSeed?: string | null; rateLimitCount?: number; quirks?: Record<string, number>; prReviewsCount?: number; crossRepoPrsCount?: number; prsMergedCount?: number; packageDownloads?: number; substanceScore?: number; distinctSkills?: number; skillXp?: Record<string, number>; activePetLookId?: string; petLookAssignments?: PetLookMap };
// Board ids: well-known fixed strings + a "quirk:<name>" dynamic family for the
// cope leaderboards (one per registered quirk in web/src/backend/quirks.ts).
type Board = "score" | "pets-count" | "rarest-pet" | "biggest-pet" | "rate-limited" | "achievements" | "breadth" | "merit" | `quirk:${string}` | `skill:${string}` | `merit:${"reviews" | "crossRepo" | "shipper" | "downloads" | "substance"}`;
type Skill = { id: string; name: string; icon: string; level: number; pct: number; xp: number };
type SkillSheet = { id: string; name: string | null; totalLevel: number; skills: Skill[] };
type Identity = { id: string; provider: string; subject: string; isPrimary: boolean; linkedAt?: string };
type MergeReq = { id: string; provider: string; subject: string };
type Billing = { tier: Tier; status: string | null; currentPeriodEnd: string | null; hasCustomer: boolean };
type AiAttestation = { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean; webauthnVerified?: boolean; expiresAt?: string };
type AchievementRow = { id: string; name: string; description: string; tier: string; category: string; unlockCount: number; unlockedAt?: string };
type WebauthnCredential = { id: string; label: string; transports: string[]; createdAt: string; lastUsedAt: string | null };
type PushPrefs = { verifiedAttestation?: boolean; newcomerToBoard?: boolean; mention?: boolean; levelUp?: boolean; achievement?: boolean; season?: boolean; marketplace?: boolean };
type GithubSync = { login: string; verified: boolean; verifiedScore: number; baseScore: number; attributionScore: number; attributionQuery: string | null; lastAttributionSyncAt: string | null; verifiedAt: string | null; totalLevel: number; playerId: string | null; wild: string[]; activePetLookId?: string; petLookAssignments?: PetLookMap; avatarSeed: string | null; showcaseSeeds: string[]; petsCount: number; rarestPetScore: number; biggestPetSize: number; isAi: boolean; aiAttestation: AiAttestation | null; pushPrefs?: PushPrefs; webauthnCredentials?: WebauthnCredential[]; rateLimitCount?: number; quirks?: Record<string, number> };
type Account = { sub: string; billing: Billing; github: GithubSync | null; identities: Identity[]; mergeRequests: MergeReq[]; achievementCount: number; following: string[] };
type TierInfo = { name: string; blurb: string; perks: string[] };
type Amount = { amount: number | null; currency: string; interval?: string };
type StripeConfig = { configured: boolean; tiers: Record<Tier, TierInfo>; prices: Record<string, string | null>; amounts: Record<string, Amount> };

const PROVIDERS: Record<string, { label: string; cls: string; href: string }> = {
  github: { label: "GitHub", cls: "gh", href: "/oauth2/github/authorization" },
  google: { label: "Google", cls: "gg", href: "/oauth2/google/authorization?client=login" },
};
const providerLabel = (p: string) => PROVIDERS[p]?.label ?? p;
const ORDER: Tier[] = ["free", "supporter", "pro"];

const money = (a?: Amount) =>
  a && a.amount != null ? `$${(a.amount / 100).toFixed(a.amount % 100 ? 2 : 0)}/${a.interval ?? "mo"}` : "";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const profileHref = (login: string) => `/profile/${encodeURIComponent(login)}`;
const isPlainPrimaryClick = (ev: MouseEvent<HTMLElement>) => ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;
const resolvePetLookId = (seed: string | null, activePetLookId: string | undefined, assignments?: PetLookMap): PetLookId => {
  const override = seed ? assignments?.[seed] : undefined;
  if (isPetLookId(override)) return override;
  return isPetLookId(activePetLookId) ? activePetLookId : DEFAULT_PET_LOOK_ID;
};
const resolveLookId = (value: string | undefined | null): PetLookId => isPetLookId(value) ? value : DEFAULT_PET_LOOK_ID;
const PET_LOOK_OPTIONS = Object.values(PET_LOOKS);

// Never throws: a network failure (offline, DNS, aborted) resolves to { ok:false, status:0 }
// instead of rejecting. Call sites guard their loading flags after `await api(...)`, so a
// thrown fetch used to leave buttons/spinners stuck forever — this makes the failure a
// normal { ok:false } the UI already knows how to surface.
const api = async (url: string, opts?: RequestInit) => {
  try {
    const r = await fetch(url, opts);
    return { ok: r.ok, status: r.status, data: r.ok ? await r.json().catch(() => null) : null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
};
const post = (url: string, body?: unknown) =>
  api(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const TierBadge = ({ tier }: { tier?: Tier }) =>
  tier && tier !== "free" ? <span className={`tierBadge ${tier}`}>{tier === "pro" ? "PRO" : "SUPPORTER"}</span> : null;

// Transparent AI marker — shown next to the handle anywhere a player appears (leaderboard,
// profile, ghost cursor, spotlight). Renders only when the player record's is_ai column is
// true (server-authoritative, not client-claimed). AI accounts score / earn pets /
// achievements identically; the badge is honesty, not a handicap.
// Earned-achievements grid. Renders grouped by category with tier-colored chips so the
// rarer ones (mythic / platinum) stand out at a glance. Used by both AccountView (your
// own) and ProfileModal (someone else's) — same data shape coming from /api/profile and
// /api/account, no client-side massaging.
const TIER_ORDER: Record<string, number> = { mythic: 0, platinum: 1, gold: 2, silver: 3, bronze: 4, secret: 5 };
const AchievementsPanel = ({ total }: { total: number }) => {
  const [items, setItems] = useState<AchievementRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async (nextCursor?: string | null) => {
    if (loading) return;
    setLoading(true);
    const suffix = nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : "";
    const r = await api(`/api/account/achievements?limit=50${suffix}`);
    if (r.ok) {
      const page = r.data as { items?: AchievementRow[]; nextCursor?: string | null };
      setItems((current) => nextCursor ? [...current, ...(page.items ?? [])] : (page.items ?? []));
      setCursor(page.nextCursor ?? null);
    }
    setLoaded(true);
    setLoading(false);
  }, [loading]);
  useEffect(() => { if (total > 0 && !loaded) void load(null); }, [total, loaded, load]);
  if (total === 0) return null;
  // Group by category; within each group, sort by tier (rarer first) for visual weight.
  const groups = new Map<string, AchievementRow[]>();
  for (const a of items) {
    const arr = groups.get(a.category) ?? [];
    arr.push(a);
    groups.set(a.category, arr);
  }
  for (const arr of groups.values()) arr.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
  return (
    <section className="card">
      <h2>Your achievements <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {total.toLocaleString()} earned</span></h2>
      {!loaded && <p className="muted">Loading achievements…</p>}
      <div className="achGroups">
        {[...groups.entries()].map(([cat, arr]) => (
          <div className="achGroup" key={cat}>
            <h3 className="achGroupName">{cat}</h3>
            <div className="achList">
              {arr.map((a) => (
                <div key={a.id} className={`achChip tier-${a.tier}`} title={`${a.description} · ${a.unlockCount.toLocaleString()} other player${a.unlockCount === 1 ? "" : "s"} earned this`}>
                  <span className="achName">{a.name}</span>
                  <span className="achTier">{a.tier}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {cursor && (
        <div className="cta" style={{ marginTop: 16 }}>
          <button className="btn ghost" disabled={loading} onClick={() => void load(cursor)}>
            {loading ? "Loading…" : `Load more · ${items.length.toLocaleString()} of ${total.toLocaleString()}`}
          </button>
        </div>
      )}
    </section>
  );
};

// Quirks panel — renders every quirk the player has hit at least once, with its
// count and the funniest tier reached. Uses the fetched /api/quirks/list registry
// for labels; tier copy is server-authoritative via the catalog. The frame matters:
// these are public cope-as-badges, the joke IS the achievement. Used by AccountView
// (your own quirks) and ProfileModal (someone else's).
const QUIRK_TIER_LABELS: Record<number, [string, string]> = {
  1: ["🥉", "bronze"], 10: ["🥈", "silver"], 100: ["🥇", "gold"], 1000: ["🏆", "mythic"],
};
const tierFor = (n: number): [string, string] => n >= 1000 ? QUIRK_TIER_LABELS[1000]! : n >= 100 ? QUIRK_TIER_LABELS[100]! : n >= 10 ? QUIRK_TIER_LABELS[10]! : QUIRK_TIER_LABELS[1]!;
const QuirksPanel = ({ quirks, title = "Quirks" }: { quirks: Record<string, number>; title?: string }) => {
  const [registry, setRegistry] = useState<{ id: string; label: string; frame: string }[]>([]);
  useEffect(() => { fetch("/api/quirks/list").then((r) => r.json()).then(setRegistry).catch(() => {}); }, []);
  const entries = Object.entries(quirks).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;
  const labelFor = (id: string) => registry.find((q) => q.id === id)?.label ?? id;
  return (
    <section className="card">
      <h2>{title} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {entries.length}</span></h2>
      <p className="muted hint">Self-reported cope ladder. Each is a 4-tier achievement family in the catalog — the bronze starts at 1, mythic at 1,000. <code>renown scan-commits</code> bumps them from your git log; CLI aliases (<code>renown wip</code>, <code>renown sycophant</code>, etc.) bump them manually.</p>
      <div className="achList" style={{ marginTop: 8 }}>
        {entries.map(([id, count]) => {
          const [emoji, tier] = tierFor(count);
          return (
            <div key={id} className={`achChip tier-${tier}`} title={registry.find((q) => q.id === id)?.frame ?? id}>
              <span className="achName">{emoji} {labelFor(id)}</span>
              <span className="achTier">{count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// RecentUnlocks — the cross-network activity feed. Shows the last N achievement
// unlocks across all verified players, newest first. Live-updates on the 'unlock'
// SSE topic (the grantAchievements call broadcasts on every batch). Clicking a
// row opens that player's profile — the social-discovery loop the leaderboard
// alone doesn't give. Hidden achievements stay hidden (the server filter is in
// /api/recent-unlocks).
type UnlockRow = {
  unlockedAt: string;
  achievement: { id: string; name: string; tier: string; category: string; description: string };
  player: { login: string; handle: string; avatarSeed: string | null; isAi: boolean; tier: Tier };
};
// FollowingFeed — the personalized counterpart to RecentUnlocks: recent unlocks from the devs
// you follow, server-filtered via /api/rivals/:me's feed. Live on the same 'unlock' SSE topic.
// Renders nothing when signed out or following no one (so it never shows an empty box).
type FollowFeedItem = { unlockedAt: string; achievement: { id: string; name: string; tier: string }; player: { login: string | null; handle: string; isAi: boolean } };
const FollowingFeed = ({ myLogin, openProfile }: { myLogin: string | null; openProfile: (login: string) => void }) => {
  const [feed, setFeed] = useState<FollowFeedItem[]>([]);
  useEffect(() => {
    if (!myLogin) { setFeed([]); return; }
    const load = () => fetch(`/api/rivals/${encodeURIComponent(myLogin)}`).then((r) => r.json()).then((d) => { if (d && Array.isArray(d.feed)) setFeed(d.feed); }).catch(() => {});
    load();
    return subscribeSync(["unlock"], () => load());
  }, [myLogin]);
  if (!myLogin || feed.length === 0) return null;
  const ago = (iso: string) => { const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
  return (
    <section className="card">
      <h2>From devs you follow <span className="eyebrow">· live</span></h2>
      <p className="muted hint">Recent unlocks from your circle. <a href={`/rivals/${encodeURIComponent(myLogin)}`}>Your rivals →</a></p>
      <div className="achList" style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 6 }}>
        {feed.slice(0, 8).map((r, i) => (
          <a key={`${r.player.login}:${r.achievement.id}:${i}`} href={r.player.login ? profileHref(r.player.login) : "#"}
            onClick={(ev) => { if (!r.player.login || !isPlainPrimaryClick(ev)) return; ev.preventDefault(); openProfile(r.player.login); }}
            className={`achChip tier-${r.achievement.tier}`}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", textAlign: "left", cursor: "pointer", borderRadius: 10 }}>
            <span><strong>@{r.player.login ?? r.player.handle}</strong>{r.player.isAi && " 🤖"} <span className="muted">unlocked</span> {r.achievement.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>{ago(r.unlockedAt)}</span>
          </a>
        ))}
      </div>
    </section>
  );
};
const RecentUnlocks = ({ openProfile }: { openProfile: (login: string) => void }) => {
  const [rows, setRows] = useState<UnlockRow[]>([]);
  useEffect(() => {
    const load = () => {
      fetch("/api/recent-unlocks?limit=20").then((r) => r.json()).then((data) => {
        if (Array.isArray(data)) setRows(data);
      }).catch(() => {});
    };
    load();
    // Live: every batch grant publishes on the 'unlock' topic. Cheap to re-fetch
    // (one indexed join, 20-row cap). No polling — SSE only.
    return subscribeSync(["unlock"], () => load());
  }, []);
  if (rows.length === 0) return null;
  // Friendly relative-time formatter (avoid pulling intl libs for a few rows).
  const ago = (iso: string) => {
    const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  return (
    <section className="card">
      <h2>Across the network <span className="eyebrow">· live</span></h2>
      <p className="muted hint">The latest unlocks anywhere on renown. Click to open a player's profile.</p>
      <div className="achList" style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 6 }}>
        {rows.slice(0, 8).map((r, i) => (
          <a
            key={`${r.player.login}:${r.achievement.id}:${i}`}
            href={profileHref(r.player.login)}
            onClick={(ev) => {
              if (!isPlainPrimaryClick(ev)) return;
              ev.preventDefault();
              openProfile(r.player.login);
            }}
            className={`achChip tier-${r.achievement.tier}`}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", textAlign: "left", cursor: "pointer", borderRadius: 10 }}
            title={r.achievement.description}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6, fontWeight: 500 }}>
                @{r.player.login}{r.player.isAi && <span style={{ fontSize: 11, opacity: 0.7 }}>🤖</span>}
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>unlocked</span>
                <span style={{ fontSize: 13 }}>{r.achievement.name}</span>
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{r.achievement.category} · {r.achievement.tier} · {ago(r.unlockedAt)}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
};

type LandingPetRow = { seed: string; login: string | null; name: string; tier: string; species: string; earnedAt: string | null };

const LandingPet = ({ seed, size = 68 }: { seed: string; size?: number }) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box: size });
  const html = `<svg width="${size}" height="${size}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">${svg}</svg>`;
  return <span className="landingPetSprite" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html }} />;
};

const LiveLandingActivity = () => {
  const [pets, setPets] = useState<LandingPetRow[]>([]);
  const [unlocks, setUnlocks] = useState<UnlockRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    const load = async () => {
      const [petResponse, unlockResponse] = await Promise.all([
        fetch("/api/pets?limit=10&sort=newest"),
        fetch("/api/recent-unlocks?limit=12"),
      ]);
      if (!active) return;
      if (petResponse.ok) {
        const page = await petResponse.json() as { pets?: LandingPetRow[] };
        setPets(page.pets ?? []);
      }
      if (unlockResponse.ok) {
        const rows = await unlockResponse.json();
        if (Array.isArray(rows)) setUnlocks(rows);
      }
    };
    void load();
    const unsubscribe = subscribeSync(["top", "unlock"], () => { void load(); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (pets.length === 0 && unlocks.length === 0) return null;
  const pulledAgo = (earnedAt: string | null) => {
    if (!earnedAt) return "pulled recently";
    const timestamp = Date.parse(earnedAt);
    if (!Number.isFinite(timestamp)) return "pulled recently";
    const minutes = Math.max(1, Math.floor((now - timestamp) / 60_000));
    if (minutes < 60) return `pulled ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `pulled ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    const days = Math.floor(hours / 24);
    return `pulled ${days} ${days === 1 ? "day" : "days"} ago`;
  };
  const petItems = pets.slice(0, 8);
  const achievementItems = unlocks.slice(0, 8);
  return (
    <section className="landingLive" aria-labelledby="landing-live-title">
      <div className="landingSectionHead">
        <div><span className="landingKicker">LIVE NETWORK</span><h2 id="landing-live-title">People are earning right now</h2></div>
        <span className="liveSignal"><i /> Synced live</span>
      </div>
      {petItems.length > 0 && <div className="landingTicker" aria-label="Recently earned pets">
        <div className="landingTickerTrack">
          {[false, true].map((duplicate) => <div className="landingTickerGroup" aria-hidden={duplicate || undefined} key={String(duplicate)}>
            {petItems.map((pet) => (
              <a className="landingPetDrop" href={`/pet/${encodeURIComponent(pet.seed)}`} key={pet.seed} tabIndex={duplicate ? -1 : undefined}>
                <LandingPet seed={pet.seed} />
                <span><strong>{pet.name || generate(pet.seed).name}</strong><small>{pet.tier} {pet.species ? `· ${pet.species}` : ""}</small><em>{pet.login ? `@${pet.login} · ` : ""}{pulledAgo(pet.earnedAt)}</em></span>
              </a>
            ))}
          </div>)}
        </div>
      </div>}
      {achievementItems.length > 0 && <div className="landingUnlockGrid">
        {achievementItems.slice(0, 6).map((row, index) => (
          <a href={profileHref(row.player.login)} className={`landingUnlock tier-${row.achievement.tier}`} key={`${row.player.login}:${row.achievement.id}:${index}`}>
            <span className="landingUnlockIcon">◆</span>
            <span><small>@{row.player.login}{row.player.isAi ? " 🤖" : ""} unlocked</small><strong>{row.achievement.name}</strong><em>{row.achievement.category} · {row.achievement.tier}</em></span>
          </a>
        ))}
      </div>}
      <div className="landingLiveLinks"><a href="/pets">Explore all pets →</a><a href="/achievements">Browse achievements →</a></div>
    </section>
  );
};

const CopyInstall = () => {
  const command = "bun add -g @absolutejs/renown";
  const [copied, setCopied] = useState(false);
  return (
    <button className="landingInstall" onClick={async () => {
      try { await navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard unavailable */ }
    }} title="Copy install command">
      <span className="landingPrompt">$</span><code>{command}</code><span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
};

const LandingPage = ({ signedIn, onGetStarted }: { signedIn: boolean; onGetStarted: () => void }) => (
  <>
    <section className="landingHero">
      <div className="landingHeroCopy">
        <span className="landingKicker">A GAME LAYER FOR REAL DEVELOPMENT</span>
        <h1>Ship code.<br /><span>Hatch legends.</span></h1>
        <p>Renown turns the work you already do into skills, achievements, quests, rankings, and unique pets generated from your real commits.</p>
        <div className="landingHeroActions">
          {signedIn
            ? <a className="btn solid" href="/pets">Open my collection</a>
            : <button className="btn solid" onClick={onGetStarted}>Start playing free</button>}
          <a className="btn ghost" href="/leaderboard">See the leaderboard</a>
        </div>
        <CopyInstall />
        <p className="landingFinePrint">Free forever · Any editor · Humans and coding agents · GitHub-verified</p>
      </div>
      <div className="landingHeroGame" aria-label="Renown game systems">
        <div className="landingHeroPet"><LandingPet seed="renown:landing:legend" size={190} /><span>LEGENDARY DROP</span></div>
        <div className="landingStatCard landingStatSkills"><strong>100</strong><span>skills to master</span></div>
        <div className="landingStatCard landingStatAchievements"><strong>10K+</strong><span>achievements</span></div>
        <div className="landingStatCard landingStatPets"><strong>#1</strong><span>serialized pet pulls</span></div>
      </div>
    </section>

    <section className="landingStart" aria-labelledby="landing-start-title">
      <div className="landingSectionHead"><div><span className="landingKicker">THREE MINUTES TO START</span><h2 id="landing-start-title">Your work is already worth XP</h2></div></div>
      <div className="landingSteps">
        <article><span>01</span><h3>Install</h3><code>bun add -g @absolutejs/renown</code><p>One lightweight CLI. No editor lock-in.</p></article>
        <article><span>02</span><h3>Link GitHub</h3><code>renown link</code><p>Run <code>gh auth login</code> if needed, then verify your public work and mint the pets it earned.</p></article>
        <article><span>03</span><h3>Wire your tools</h3><code>renown install-agent all</code><p>Add first-party Codex and Claude hooks, plus the optional tmux HUD.</p></article>
      </div>
    </section>

    <LiveLandingActivity />

    <section className="landingWhy">
      <div><span className="landingKicker">NOT A COMMIT-COUNT CASINO</span><h2>Good work beats busywork.</h2><p>Craft scoring discounts generated files, lockfiles, formatting churn, tiny commits, and duplicates. Tests, docs, substantive changes, open source, and contributing to projects you don’t own matter more.</p><a href="https://github.com/absolutejs/renown/blob/main/docs/trust-model.md">Read the trust model →</a></div>
      <div className="landingWhyGrid"><article><strong>Pets</strong><span>Deterministic collectibles whose seed is the commit itself.</span></article><article><strong>Skills</strong><span>100 disciplines with an OSRS-style progression curve.</span></article><article><strong>Achievements</strong><span>Curated milestones plus deep procedural families.</span></article><article><strong>Competition</strong><span>Global, project, skill, merit, weekly, and season boards.</span></article></div>
    </section>

    <section className="landingFinal"><span className="landingKicker">YOUR NEXT COMMIT COULD HATCH A MYTHIC</span><h2>Make the work visible.</h2><p>Install Renown, link GitHub, and see what your development history has already earned.</p><div className="landingHeroActions">{signedIn ? <a className="btn solid" href="/pets">Open my collection</a> : <button className="btn solid" onClick={onGetStarted}>Start playing free</button>}<a className="btn ghost" href="/guide">Read the setup guide</a></div></section>
  </>
);

// MeritPanel — the meritorious half of the leaderboard. One row per signal with
// current sub-counter, tier (I-V), and a progress bar toward the next threshold.
// Sourced from /api/merit/:login. Re-fetches on `merit` SSE topic so a player
// running `renown merit-sync` in another tab sees the panel update live.
const MeritPanel = ({ login, title = "Merit" }: { login: string; title?: string }) => {
  type Ladder = { id: string; label: string; flavor: string; value: number; tier: number; nextThreshold: number | null };
  type MeritData = {
    login: string;
    meritScore: number;
    signals: { reviews: number; crossRepo: number; authored: number; merged: number; mergeRatio: number; downloads: number; substanceScore: number; substanceSampleSize: number };
    ladders: Ladder[];
    lastSyncAt: string | null;
  };
  const [data, setData] = useState<MeritData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/merit/${encodeURIComponent(login)}`);
        const j = await r.json() as MeritData | { error: string };
        if (cancelled) return;
        if ("error" in j) setError(j.error); else { setData(j); setError(null); }
      } catch { /* keep last data */ }
    };
    load();
    const unsubscribe = subscribeSync(["merit"], (evt) => {
        const p = evt.payload as { login?: string } | undefined;
        if (p?.login?.toLowerCase() === login.toLowerCase()) load();
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [login]);
  if (error) return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted hint" style={{ marginBottom: 0 }}>
        No merit signals yet — run <code>renown merit</code> to fetch your PR-review / cross-repo / shipper / maintainer numbers from GitHub.
      </p>
    </section>
  );
  if (!data) return null;
  // Tier emoji ladder: matches the quirks visual language (bronze→mythic).
  const tierEmoji = ["", "🥉", "🥈", "🥇", "💎", "🔮"];
  const fmt = (n: number) => n.toLocaleString();
  return (
    <section className="card">
      <h2>{title} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {fmt(data.meritScore)} pts</span></h2>
      <p className="muted hint">The hard-to-game half: signals require someone else (a reviewer, a maintainer, an installer) to validate your work. Refresh with <code>renown merit</code>.</p>
      <div className="achList" style={{ marginTop: 8, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        {data.ladders.map((l) => {
          const pct = l.nextThreshold ? Math.min(100, Math.round((l.value / l.nextThreshold) * 100)) : 100;
          const isSubstance = l.id === "substance";
          const displayValue = isSubstance ? `${l.value}%` : fmt(l.value);
          const displayNext = l.nextThreshold ? (isSubstance ? `${l.nextThreshold}%` : fmt(l.nextThreshold)) : "max";
          return (
            <div key={l.id} className={`achChip tier-${l.tier > 0 ? "gold" : "silver"}`} style={{ display: "flex", flexDirection: "column", alignItems: "stretch", padding: "8px 12px", gap: 4 }} title={l.flavor}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="achName">{tierEmoji[l.tier] || "·"} {l.label} {l.tier > 0 ? `${"I".repeat(l.tier).slice(0, l.tier === 4 ? 4 : 3)}${l.tier === 4 ? "" : l.tier === 5 ? "V" : ""}` : ""}</span>
                <span className="achTier">{displayValue} / {displayNext}</span>
              </div>
              <div style={{ height: 4, background: "rgba(255,255,255,.08)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: l.tier > 0 ? "linear-gradient(90deg, #facc15, #fbbf24)" : "linear-gradient(90deg, #71717a, #a1a1aa)" }} />
              </div>
            </div>
          );
        })}
      </div>
      {data.lastSyncAt && (
        <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          last synced {new Date(data.lastSyncAt).toLocaleString()}
        </p>
      )}
    </section>
  );
};

const AiBadge = ({ isAi, attestation, compact, style }: { isAi?: boolean; attestation?: AiAttestation | null; compact?: boolean; style?: React.CSSProperties }) => {
  if (!isAi) return null;
  // Tooltip composition: base note + attestation provider + verification source +
  // evidence URL. Three trust tiers, visually distinct:
  //   ✓ verified       — provider-signed JWT against the registry's JWKS
  //   ✦ self-keyed     — WebAuthn assertion from a registered hardware key
  //   (nothing)        — public claim, anyone could post it
  const verified = !!attestation?.verified;
  const webauthnVerified = !!attestation?.webauthnVerified;
  const expiresAt = attestation?.expiresAt ? Date.parse(attestation.expiresAt) : NaN;
  const expiresInDays = !isNaN(expiresAt) ? Math.round((expiresAt - Date.now()) / (24 * 3600 * 1000)) : null;
  const expiringSoon = expiresInDays !== null && expiresInDays >= 0 && expiresInDays <= 7;
  const trustNote = verified
    ? ` · cryptographically verified by provider${expiresInDays !== null ? ` (expires in ${expiresInDays}d)` : ""}`
    : webauthnVerified
      ? " · self-keyed (WebAuthn hardware key)"
      : " (public claim)";
  const title = attestation
    ? `AI participant · attested as ${attestation.provider}${trustNote}${attestation.evidenceUrl ? ` · evidence: ${attestation.evidenceUrl}` : ""}`
    : "AI participant — earns score and pets the same way humans do, with the badge for transparency";
  const mark = verified ? " ✓" : webauthnVerified ? " ✦" : "";
  const label = compact ? "🤖" : attestation ? `🤖 ${attestation.provider}${mark}` : "🤖 AI";
  return <span className={`aiBadge${compact ? " compact" : ""}${attestation ? " attested" : ""}${verified ? " verified" : ""}${webauthnVerified && !verified ? " selfKeyed" : ""}${expiringSoon ? " expiringSoon" : ""}`} style={style} title={title}>{label}</span>;
};

// Site-wide rate-limited listener. Plays a sad trombone every time someone reports
// being throttled. Site-wide, so the schadenfreude is communal. The audio.ts voice is
// gated on isSoundOn (toggle in the header) — silent when sound is off.
const RateLimitedAudioAnnouncer = () => {
  useEffect(() => {
    return subscribeSync(["rate-limited"], (evt) => {
        if (evt.topic !== "rate-limited") return;
        playSadTrombone();
    });
  }, []);
  return null;
};

// Site-wide announcement banner driven by the 'verified-attestation' hub topic. Renders
// a transient toast at the top-right when a JWT-verified attestation lands anywhere on
// the platform. 8s auto-fade; multiple events queue so a burst doesn't clobber itself.
// Only fires on cryptographically-verified events (the matching hub.publish in
// applyAttestation is gated on `verified === true`) — public claims stay quiet.
//
// Pairs with a Notifications API path: when the tab is hidden AND the user has granted
// notification permission, also raise a real OS notification so they don't miss the
// moment. Honest scope — this is the foreground Notifications API path; full cross-tab
// Push API (service worker + VAPID + web-push) is a future upgrade and not done here.
type Announcement = { id: number; login: string; provider: string; claimedAt: string };
const VerifiedAttestationAnnouncer = ({ openProfile, enabled }: { openProfile: (login: string) => void; enabled: boolean }) => {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const nextIdRef = useRef(1);
  useEffect(() => {
    // pushPrefs.verifiedAttestation === false silences BOTH the in-page toast AND
    // the OS notification — opting out is consistent across surfaces. Anonymous /
    // logged-out viewers default to opted-in (enabled=true at the call site).
    if (!enabled) return;
    return subscribeSync(["verified-attestation"], (evt) => {
        const payload = evt.payload as { login: string; provider: string; claimedAt: string } | undefined;
        if (evt.topic !== "verified-attestation" || !payload) return;
        const id = nextIdRef.current++;
        const ann: Announcement = { id, ...payload };
        setQueue((q) => [...q, ann]);
        window.setTimeout(() => setQueue((q) => q.filter((a) => a.id !== id)), 8000);
        // OS notification on hidden tab — pairs with the in-page banner so a user
        // looking at another tab still gets the moment. Click focuses + opens profile.
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && typeof document !== "undefined" && document.hidden) {
          const notif = new Notification("🤖 Verified AI attestation", {
            body: `@${ann.login} attested as ${ann.provider} ✓`,
            tag: `attestation:${ann.login}:${ann.claimedAt}`,
          });
          notif.onclick = () => { window.focus(); openProfile(ann.login); notif.close(); };
        }
    });
  }, [openProfile, enabled]);
  if (queue.length === 0) return null;
  return (
    <div className="announceStack" role="status" aria-live="polite">
      {queue.map((a) => (
        <button key={a.id} className="announceToast" onClick={() => openProfile(a.login)} title="Click to view profile">
          <span className="announceLabel">🤖 Verified attestation</span>
          <span className="announceWho">@{a.login}</span>
          <span className="muted">as <strong>{a.provider}</strong> ✓</span>
        </button>
      ))}
    </div>
  );
};

// Per-tab anonymous session id for the ghost-cursor feature. Stored in sessionStorage so
// each tab stays consistent for its lifetime but no cross-tab linking happens. Server
// only sees the sid + the rowId you're hovering — no login attached unless you opt in
// via the cursorLabel toggle (which adds your login + avatarSeed to the broadcast).
const sidKey = "renown:sid";
const cursorLabelKey = "renown:cursorLabel";
const getSid = () => {
  if (typeof window === "undefined") return "ssr";
  let s = window.sessionStorage.getItem(sidKey);
  if (!s) {
    s = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 16);
    window.sessionStorage.setItem(sidKey, s);
  }
  return s;
};
const isCursorLabelOn = () => typeof window !== "undefined" && window.localStorage?.getItem(cursorLabelKey) === "on";
const setCursorLabelOn = (on: boolean) => { if (typeof window !== "undefined") window.localStorage.setItem(cursorLabelKey, on ? "on" : "off"); };
// Cheap hue from sid — deterministic so the same other-user always reads as the same color.
const colorForSid = (sid: string) => {
  let h = 0;
  for (let i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 80% 65%)`;
};

// Toggle that lives in the Account view (Privacy section). Flipping it on means future
// cursor POSTs include your login + avatarSeed so other viewers see your handle/avatar
// instead of an anonymous dot when you hover a leaderboard row.
const CursorLabelToggle = () => {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isCursorLabelOn()), []);
  return (
    <label className="prefRow">
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setCursorLabelOn(e.target.checked); }} />
      <span>Show my handle and avatar to other viewers when I hover the leaderboard</span>
    </label>
  );
};

// Tiny header toggle for the synth voices in audio.ts. The toggle click itself is the
// user-gesture that authorizes the AudioContext to start, so enabling sound here is what
// unlocks playback for the rest of the session — no separate "unmute" prompts elsewhere.
// urlBase64ToUint8Array — VAPID public key arrives as URL-safe base64; PushManager
// wants a Uint8Array of the raw bytes. Standard helper used by every web-push tutorial.
const urlBase64ToUint8Array = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const norm = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(norm);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

// Best-effort Web Push registration. Runs once when sound is enabled (gesture-bound
// moment), after the Notification permission is granted. If VAPID isn't configured on
// the server (RENOWN_VAPID_* env unset), the /api/push-config call returns
// configured=false and this no-ops. Failures swallow silently — the in-page banner +
// the (foreground-only) Notifications API path still cover the same event for current
// tabs; push is the upgrade that reaches closed tabs.
const registerWebPush = async () => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || typeof PushManager === "undefined") return;
  try {
    const cfg = await fetch("/api/push-config").then((r) => r.json()) as { configured: boolean; publicKey: string | null };
    if (!cfg.configured || !cfg.publicKey) return;
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
      });
    }
    // POST to the server. toJSON gives { endpoint, keys: { p256dh, auth } } — exactly
    // the shape /api/account/push-subscribe wants.
    const json = sub.toJSON();
    await fetch("/api/account/push-subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(json),
    });
  } catch (e) {
    console.warn("web push registration failed", e);
  }
};

const SoundToggle = ({ labeled = false }: { labeled?: boolean }) => {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isSoundOn()), []);
  // Toggling sound off mid-session should kill the pad too; turning sound back on while
  // the menagerie is in view doesn't auto-restart it (the view effect below will catch
  // the next re-entry). This keeps the pad lifecycle owned by the view, not by global state.
  //
  // Enabling sound is also the gesture-bound moment to ask for OS notifications + Web
  // Push registration — the browser only allows the prompts from a user gesture, and
  // people who opted into sound are the right cohort to also opt into background
  // notifications (both are "make this page notice me even when I'm not looking").
  return (
    <button
      className="soundToggle"
      onClick={async () => {
        const next = !on;
        setSoundOn(next);
        setOn(next);
        if (!next) { stopAmbientPad(); return; }
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          const perm = await Notification.requestPermission();
          if (perm === "granted") void registerWebPush();
        } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          void registerWebPush();   // permission already granted from a previous session
        }
      }}
      title={on ? "Sound on — click to mute" : "Sound off — click to enable (also asks for notifications)"}
      aria-label={on ? "Mute sound" : "Enable sound"}
    >
      <span aria-hidden>{on ? "🔊" : "🔇"}</span>
      {labeled && <span>{on ? "Sound on" : "Sound off"}</span>}
    </button>
  );
};

type ThemeChoice = "light" | "dark";
const THEME_KEY = "renown:theme";

const AccountMenu = ({ account, user, onAccount, onSignOut }: {
  account: Account;
  user: { email?: string; first_name?: string } | null;
  onAccount: () => void;
  onSignOut: () => void;
}) => {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    const initial: ThemeChoice = saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);
  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") menuRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  const chooseTheme = (next: ThemeChoice) => {
    setTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
  };
  const login = account.github?.login;
  const label = login ? `@${login}` : user?.first_name || user?.email || "Account";
  return (
    <details className="accountMenu" ref={menuRef}>
      <summary aria-label="Open account menu">
        <span className="accountAvatar" aria-hidden>
          {account.github?.avatarSeed ? <LandingPet seed={account.github.avatarSeed} size={32} /> : label.slice(0, 1).toUpperCase()}
        </span>
        <span className="accountMenuName">{label}</span>
        <span className="accountChevron" aria-hidden>⌄</span>
      </summary>
      <div className="accountMenuPanel">
        <div className="accountMenuIdentity"><strong>{label}</strong><span>{user?.email && user.email !== label ? user.email : `${account.billing.tier} plan`}</span></div>
        {login && <a href={profileHref(login)}><span aria-hidden>◉</span><span>Profile</span></a>}
        <button onClick={() => { menuRef.current?.removeAttribute("open"); onAccount(); }}><span aria-hidden>⚙</span><span>Account &amp; plans</span></button>
        {login && <a href={`/quests/${encodeURIComponent(login)}`}><span aria-hidden>◆</span><span>Quests</span></a>}
        {login && <a href={`/rivals/${encodeURIComponent(login)}`}><span aria-hidden>↗</span><span>Rivals</span></a>}
        <div className="accountMenuDivider" />
        <div className="themeRow"><span>Appearance</span><div role="group" aria-label="Color theme"><button className={theme === "light" ? "on" : ""} onClick={() => chooseTheme("light")}>Light</button><button className={theme === "dark" ? "on" : ""} onClick={() => chooseTheme("dark")}>Dark</button></div></div>
        <SoundToggle labeled />
        <div className="accountMenuDivider" />
        <button className="accountLogout" onClick={() => { menuRef.current?.removeAttribute("open"); onSignOut(); }}><span aria-hidden>↪</span><span>Log out</span></button>
      </div>
    </details>
  );
};

// ── Top this week (the weekly heat + recap-card discovery) ───────────────────
// The home leaderboard ranks ALL-TIME; this surfaces who earned the most renown in the last
// 7 days (the weekly attribution delta the /top?window=week board ranks by), each linking to
// their shareable recap card. Hidden entirely on a quiet week (no one with a positive delta).
const TopThisWeek = ({ openProfile }: { openProfile: (login: string) => void }) => {
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/top?n=8&window=week").then((r) => r.json())
      .then((d) => { if (live) setRows(Array.isArray(d) ? d.filter((e: Entry) => (e.weekXp ?? 0) > 0) : []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="card">
      <h2>Top this week <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· renown earned in the last 7 days</span></h2>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((e, i) => (
          <div key={e.id ?? e.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
            <span style={{ width: 28, textAlign: "right", fontWeight: 700, opacity: 0.8 }}>{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
            {e.avatarSeed && <RepoPet seed={e.avatarSeed} />}
            <button onClick={() => e.login && openProfile(e.login)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{e.login ?? e.name}{e.isAi && <span style={{ fontSize: 11, opacity: 0.7 }}> 🤖</span>}</button>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, color: "#86efac" }}>+{repoFmt(e.weekXp ?? 0)}</span>
            {e.login && <a href={`/recap/${encodeURIComponent(e.login)}`} style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", textDecoration: "none" }}>week →</a>}
          </div>
        ))}
      </div>
    </section>
  );
};

// ── Trending repos (discovery loop) ─────────────────────────────────────────
// The home page's repo-discovery surface: profiles rank PEOPLE, this ranks the REPOS where
// renown is being earned. Each card links to that repo's public /project board — closing the
// loop profiles → repos → boards → more profiles. Lightweight 2D pet sprites (no three.js)
// so the section stays cheap to render alongside the WebGL leaderboard.
type TopRepo = { key: string; owner: string; repo: string; name: string; stars: number; oss: boolean; devs: number; xp: number; commits: number; topLogin: string | null; topSeed: string | null };
const repoFmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const RepoPet = ({ seed }: { seed: string }) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box: 40 });
  const html = `<svg width="40" height="40" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>`;
  return <span style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: html }} />;
};
const TrendingRepos = () => {
  // Default to "this week" so "trending" actually means recent activity, not an all-time
  // ranking. Toggling to "all" shows the all-time leaderboard of repos by total renown.
  const [period, setPeriod] = useState<"week" | "all">("week");
  const [repos, setRepos] = useState<TopRepo[] | null>(null);
  useEffect(() => {
    let live = true;
    setRepos(null);
    fetch(`/api/projects/top?n=12&window=${period}`).then((r) => r.json())
      .then((d) => { if (live) setRepos(Array.isArray(d) ? d : []); })
      .catch(() => { if (live) setRepos([]); });
    return () => { live = false; };
  }, [period]);
  return <TrendingReposShell period={period} setPeriod={setPeriod} repos={repos} />;
};

const TrendingReposShell = ({ period, setPeriod, repos }: { period: "week" | "all"; setPeriod: (p: "week" | "all") => void; repos: TopRepo[] | null }) => (
  <section className="card">
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <h2 style={{ margin: 0 }}>Trending repos <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {period === "week" ? "active this week" : "all time"}</span></h2>
      <nav style={{ display: "flex", gap: 4, fontSize: 13 }}>
        {([["week", "This week"], ["all", "All time"]] as const).map(([p, label]) => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: "4px 10px", borderRadius: 999, cursor: "pointer",
            background: period === p ? "rgba(134,239,172,.16)" : "rgba(255,255,255,.04)",
            border: `1px solid ${period === p ? "rgba(134,239,172,.4)" : "rgba(255,255,255,.10)"}`,
            color: "inherit", fontWeight: period === p ? 700 : 500,
          }}>{label}</button>
        ))}
      </nav>
    </div>
    <p className="muted hint">{period === "week"
      ? "Repos where renown is being earned right now — ranked by how many contributors are active there this week. Each links to its public leaderboard."
      : "Repos ranked by the all-time renown their contributors earn here. Each links to its public leaderboard — add the badge to yours from any repo's board."}</p>
    {repos === null
      ? <p className="muted" style={{ marginTop: 10 }}>Loading…</p>
      : repos.length === 0
        ? <p className="muted" style={{ marginTop: 10 }}>{period === "week" ? "No repos active this week yet — check All time." : "No repos yet."}</p>
        : (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {repos.map((r) => (
              <a key={r.key} href={`/project/${r.key}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                {r.topSeed && <RepoPet seed={r.topSeed} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}</div>
                  <div className="muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                    {r.stars > 0 && <>★ {repoFmt(r.stars)} · </>}{r.devs} dev{r.devs === 1 ? "" : "s"}{period === "week" ? " active" : ""} · {repoFmt(r.xp)} XP · {repoFmt(r.commits)} commits
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
  </section>
);

// ── Leaderboard ────────────────────────────────────────────────────────────
// seedOf: which pet renders next to each row on this board. For Score and Most-pets we
// show the player's chosen avatar (their identity pet); for Rarest/Biggest boards we show
// the specific pet the board is ranking by — so the picture under the rank IS the thing
// they're #1 at.
const BOARDS: { id: Board; label: string; hint: string; statOf: (e: Entry) => string; seedOf: (e: Entry) => string | null | undefined }[] = [
  { id: "score", label: "Score", hint: "GitHub base + Co-Authored-By attribution + merit. The headline number.", statOf: (e) => (e.score ?? 0).toLocaleString(), seedOf: (e) => e.avatarSeed },
  { id: "merit", label: "Merit", hint: "Rolled-up merit score: PR reviews, cross-repo PRs, shipper, maintainer, substance.", statOf: (e) => `${(e.meritScore ?? 0).toLocaleString()} merit`, seedOf: (e) => e.avatarSeed },
  { id: "merit:reviews", label: "Reviewer", hint: "PRs you've reviewed for other people. The carriage that pulls open source.", statOf: (e) => `${(e.prReviewsCount ?? 0).toLocaleString()} reviews`, seedOf: (e) => e.avatarSeed },
  { id: "merit:crossRepo", label: "Contributor", hint: "Merged PRs in repos you don't own. The real OSS signal.", statOf: (e) => `${(e.crossRepoPrsCount ?? 0).toLocaleString()} PRs`, seedOf: (e) => e.avatarSeed },
  { id: "merit:shipper", label: "Shipper", hint: "PRs you opened and landed.", statOf: (e) => `${(e.prsMergedCount ?? 0).toLocaleString()} merged`, seedOf: (e) => e.avatarSeed },
  { id: "merit:downloads", label: "Maintainer", hint: "Monthly downloads across all npm packages you maintain.", statOf: (e) => `${(e.packageDownloads ?? 0).toLocaleString()}/mo`, seedOf: (e) => e.avatarSeed },
  { id: "merit:substance", label: "Substance", hint: "RAG-classified mean substance of your commits (typo fixes count for less).", statOf: (e) => `${((e.substanceScore ?? 0) * 100).toFixed(0)}%`, seedOf: (e) => e.avatarSeed },
  { id: "pets-count", label: "Most pets", hint: "Total serialized pet copies pulled from your attributed commits.", statOf: (e) => `${e.petsCount ?? 0} pets`, seedOf: (e) => e.avatarSeed },
  { id: "rarest-pet", label: "Rarest pet", hint: "OpenRarity score of the rarest pet in your menagerie.", statOf: (e) => `${(e.rarestPetScore ?? 0).toFixed(2)} rarity`, seedOf: (e) => e.rarestPetSeed ?? e.avatarSeed },
  { id: "biggest-pet", label: "Biggest pet", hint: "Size of your largest pet (1-100, drives voxel count).", statOf: (e) => `size ${e.biggestPetSize ?? 0}`, seedOf: (e) => e.biggestPetSeed ?? e.avatarSeed },
  { id: "achievements", label: "Achievements", hint: "Total achievements unlocked — the trophy cabinet. Ranks the most decorated devs on renown.", statOf: (e) => `${(e.ach ?? 0).toLocaleString()} unlocked`, seedOf: (e) => e.avatarSeed },
  { id: "breadth", label: "Generalist", hint: "Breadth — distinct skills you've logged XP in. Ranks the most well-rounded devs.", statOf: (e) => `${(e.distinctSkills ?? 0).toLocaleString()} skills`, seedOf: (e) => e.avatarSeed },
  { id: "rate-limited", label: "🤖 Most rate-limited", hint: "Most lovingly throttled by their providers. The cope is the achievement; the achievement is real.", statOf: (e) => `${(e.rateLimitCount ?? 0).toLocaleString()} 429s`, seedOf: (e) => e.avatarSeed },
];

// Top AI account by current verified score — fetched separately so it stays visible no
// matter what audience filter the leaderboard is showing. Re-fetches on `top` SSE since
// the AI's rank can change when anyone (AI or human) syncs. Click → open profile.
const AiOfTheWeekBanner = ({ openProfile }: { openProfile: (login: string) => void }) => {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [weekDelta, setWeekDelta] = useState<number | null>(null);
  useEffect(() => {
    // Initial pull on mount; then live updates via the 'weekly-ai-leader' hub topic
    // (server publishes on each /api/verify when the leader login changes — no spam on
    // unchanged ticks). Falls back to all-time leader if the week-window is empty.
    const load = async () => {
      try {
        const wk = await fetch("/api/top?n=1&audience=ai&window=week").then((r) => r.json()) as Entry[];
        const top = wk[0] ?? (await fetch("/api/top?n=1&audience=ai").then((r) => r.json()) as Entry[])[0] ?? null;
        if (top?.login) {
          const g = await fetch(`/api/growth/${encodeURIComponent(top.login)}?days=7`).then((r) => r.json()) as { delta?: number };
          setWeekDelta(g?.delta ?? null);
        }
        setEntry(top ?? null);
      } catch { /* leave previous state */ }
    };
    load();
    // Two subscriptions: 'weekly-ai-leader' for leader-change events (cheap, fires only
    // when the login changes), 'top' as a fallback nudge to re-pull delta numbers since
    // the leader's own attribution might update without a leader-change.
    return subscribeSync(["weekly-ai-leader", "top"], (evt) => {
        const payload = evt.payload as { login?: string; verifiedScore?: number; aiAttestation?: Entry["aiAttestation"]; avatarSeed?: string | null } | undefined;
        if (evt.topic === "weekly-ai-leader" && payload?.login) {
          setEntry((cur) => ({ ...(cur ?? { name: payload.login!, level: 0, xp: 0, streak: 0, ach: 0 }), login: payload.login!, score: payload.verifiedScore, aiAttestation: payload.aiAttestation, avatarSeed: payload.avatarSeed ?? null, isAi: true }));
          fetch(`/api/growth/${encodeURIComponent(payload.login)}?days=7`).then((r) => r.json()).then((g: { delta?: number }) => setWeekDelta(g?.delta ?? null)).catch(() => {});
        } else if (evt.topic === "top") {
          load();
        }
    });
  }, []);
  if (!entry?.login) return null;
  return (
    <button
      className="aiOtwBanner"
      onClick={() => openProfile(entry.login!)}
      title="Top AI participant this week (by attribution-score delta) · click to open their profile"
    >
      <span className="aiOtwLabel">🤖 AI of the Week</span>
      <span className="aiOtwName">@{entry.login}</span>
      <AiBadge isAi attestation={entry.aiAttestation} compact />
      <span className="aiOtwScore">{(entry.score ?? 0).toLocaleString()}</span>
      <span className="muted" style={{ fontSize: 11 }}>verified score{weekDelta !== null && weekDelta > 0 && <> · <span style={{ color: "#86efac" }}>+{weekDelta.toLocaleString()}</span> this week</>}</span>
    </button>
  );
};

// Rotating "quirk of the week" featured banner. Server picks the quirk by ISO week
// (deterministic) and returns the current leader. Cycles through all 29 quirks over
// the year. Reads from /api/quirks/featured.
type FeaturedQuirk = { quirk: { id: string; label: string; frame: string } | null; leader: { login: string | null; avatarSeed: string | null; count: number } | null };
const QuirkOfTheWeekBanner = ({ openProfile }: { openProfile: (login: string) => void }) => {
  const [data, setData] = useState<FeaturedQuirk | null>(null);
  useEffect(() => {
    fetch("/api/quirks/featured").then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  if (!data?.quirk || !data.leader?.login) return null;
  return (
    <button
      className="aiOtwBanner"
      style={{ background: "linear-gradient(90deg, rgba(255,200,80,.18), rgba(180,120,255,.10))", borderColor: "rgba(255,200,80,.45)" }}
      onClick={() => openProfile(data.leader!.login!)}
      title={`This week's featured quirk: ${data.quirk!.frame}`}
    >
      <span className="aiOtwLabel" style={{ color: "#ffe9b3" }}>🏆 Quirk of the Week — {data.quirk.label}</span>
      <span className="aiOtwName">@{data.leader.login}</span>
      <span className="aiOtwScore">{data.leader.count.toLocaleString()}</span>
      <span className="muted" style={{ fontSize: 11 }}>and counting</span>
    </button>
  );
};

type Audience = "all" | "humans" | "ai";
const Board = ({ top, board, setBoard, audience, setAudience, boardWindow, setBoardWindow, sel, setSel, sheet, openProfile, freshIds, myLogin }:
  { top: Entry[]; board: Board; setBoard: (b: Board) => void; audience: Audience; setAudience: (a: Audience) => void; boardWindow: "all" | "week" | "season"; setBoardWindow: (w: "all" | "week" | "season") => void; sel: string | null; setSel: (id: string) => void; sheet: SkillSheet | null; openProfile: (login: string) => void; freshIds: Set<string>; myLogin: string | null }) => {
  const skills = (sheet?.skills ?? []).slice().sort((a, b) => b.level - a.level || b.xp - a.xp);
  // Client-side quirks registry, fetched once. Used to populate the cope-leaderboard
  // dropdown AND to derive the meta (label / hint / statOf) when a quirk:* board is
  // active. Cached for an hour by the server's cache-control header.
  const [quirkRegistry, setQuirkRegistry] = useState<{ id: string; label: string; frame: string }[]>([]);
  useEffect(() => { fetch("/api/quirks/list").then((r) => r.json()).then(setQuirkRegistry).catch(() => {}); }, []);
  const quirkName = typeof board === "string" && board.startsWith("quirk:") ? board.slice("quirk:".length) : null;
  const activeQuirk = quirkName ? quirkRegistry.find((q) => q.id === quirkName) : null;
  const skillName = typeof board === "string" && board.startsWith("skill:") ? board.slice("skill:".length) : null;
  const activeSkill = skillName ? SKILLS.find((s) => s.id === skillName) : null;
  // Derive meta dynamically for quirk:* and skill:* boards; fall back to the static BOARDS
  // array for fixed boards.
  const meta = activeQuirk
    ? { id: board, label: `🎭 ${activeQuirk.label}`, hint: `${activeQuirk.frame} The cope leaderboard for this quirk. Self-reported via \`renown ${activeQuirk.id}\` (or scan-commits). The badge is real; the cope is the achievement.`, statOf: (e: Entry) => `${(e.quirks?.[activeQuirk.id] ?? 0).toLocaleString()}`, seedOf: (e: Entry) => e.avatarSeed }
    : activeSkill
    ? { id: board, label: `${activeSkill.icon} ${activeSkill.name}`, hint: `Top devs by ${activeSkill.name} XP — GitHub-verified first, self-reported as fallback. One of ${SKILLS.length} skill boards.`, statOf: (e: Entry) => `${(e.skillXp?.[activeSkill.id] ?? 0).toLocaleString()} XP`, seedOf: (e: Entry) => e.avatarSeed }
    : (BOARDS.find((b) => b.id === board) ?? BOARDS[0]);
  // Spotlight target: whichever row the cursor is over, falling back to the selected row,
  // then the leader. Decoupled from `sel` because hover should be ephemeral (no click cost).
  const [hovered, setHovered] = useState<string | null>(null);
  // Throttle the rare-board hover gong: re-firing on every cursor pixel-move (mouse drag
  // through the list) would be miserable. 350ms is long enough to feel intentional but
  // short enough to fire on most distinct row hovers.
  const lastGongRef = useRef(0);
  const trySoundOnHover = () => {
    if (board !== "rarest-pet" && board !== "biggest-pet") return;
    const now = performance.now();
    if (now - lastGongRef.current < 350) return;
    lastGongRef.current = now;
    playGong();
  };

  // ── Ghost cursors ────────────────────────────────────────────────────────
  // POST our hover to /api/cursor (throttled), subscribe to /sync?topics=cursors, render
  // small colored dots next to each row that another tab is currently hovering. Anonymous
  // and ephemeral — entries auto-expire 2.5s after the last update from that sid.
  const mySid = getSid();
  const [cursors, setCursors] = useState<Map<string, { rowId: string | null; board: string | null; label: string | null; avatarSeed: string | null; avatarLookId?: PetLookId; isAi: boolean; at: number }>>(() => new Map());
  const lastCursorPostRef = useRef({ at: 0, rowId: null as string | null });
  const postCursor = useCallback((rowId: string | null) => {
    const now = performance.now();
    // Throttle: same rowId within 800ms is suppressed; different rowId may post every 150ms.
    if (rowId === lastCursorPostRef.current.rowId && now - lastCursorPostRef.current.at < 800) return;
    if (now - lastCursorPostRef.current.at < 150) return;
    lastCursorPostRef.current = { at: now, rowId };
    // Two routes — pick by opt-in + auth state. The client NEVER sends its own label,
    // avatarSeed, or isAi flag in the body: the authenticated path looks all three up
    // server-side from the player row, so a malicious tab can't impersonate another
    // user's handle or hide its AI flag. The anonymous path just broadcasts the sid +
    // hover target (no identity attached).
    const wantLabel = isCursorLabelOn() && !!myLogin;
    const url = wantLabel ? "/api/account/cursor" : "/api/cursor";
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",      // session cookie needed for /api/account/cursor
      body: JSON.stringify({ sid: mySid, rowId, board }),
    }).catch(() => {});
  }, [mySid, board, myLogin]);
  // SSE: subscribe once; update the cursor map per incoming event. Cleanup interval
  // discards entries older than the fade window so the overlay self-empties.
  useEffect(() => {
    const unsubscribe = subscribeSync(["cursors"], (evt) => {
        const payload = evt.payload as { sid: string; rowId: string | null; board: string | null; label: string | null; avatarSeed: string | null; avatarLookId?: string; isAi?: boolean; at: number } | undefined;
        if (evt.topic !== "cursors" || !payload) return;
        const { sid, rowId, board: b, label, avatarSeed, avatarLookId, isAi, at } = payload;
        if (sid === mySid) return;     // never render our own ghost
        setCursors((m) => {
          const n = new Map(m);
          const resolvedLook = isPetLookId(avatarLookId) ? avatarLookId : undefined;
          n.set(sid, { rowId, board: b, label: label ?? null, avatarSeed: avatarSeed ?? null, avatarLookId: resolvedLook, isAi: !!isAi, at });
          return n;
        });
    });
    const sweep = window.setInterval(() => {
      const cutoff = Date.now() - 2500;
      setCursors((m) => {
        let changed = false;
        const n = new Map(m);
        for (const [sid, v] of n) if (v.at < cutoff) { n.delete(sid); changed = true; }
        return changed ? n : m;
      });
    }, 600);
    return () => { unsubscribe(); window.clearInterval(sweep); };
  }, [mySid]);
  // For each row, structured ghost entries currently hovering it (other tabs only, same
  // board). Returns the raw cursor info per sid so the renderer can choose between
  // anonymous dot and labeled mini-avatar per ghost.
  const ghostsFor = (rowId: string | undefined): { sid: string; color: string; label: string | null; avatarSeed: string | null; avatarLookId?: PetLookId; isAi: boolean }[] => {
    if (!rowId) return [];
    const out: { sid: string; color: string; label: string | null; avatarSeed: string | null; avatarLookId?: PetLookId; isAi: boolean }[] = [];
    for (const [sid, v] of cursors) if (v.rowId === rowId && v.board === board) out.push({ sid, color: colorForSid(sid), label: v.label, avatarSeed: v.avatarSeed, avatarLookId: v.avatarLookId, isAi: v.isAi });
    return out;
  };

  // ── Swarm cinematic ─────────────────────────────────────────────────────
  // When 3+ distinct other-tab cursors converge on a single row for ≥1s, take it as a
  // social signal and spotlight that row: setSel (which the spotlight already follows
  // when nothing is hovered), apply a CSS .swarm pulse to the row, and ring a gong.
  // Per-row cooldown so the cinematic doesn't refire until ghosts disperse and a new
  // 3+ swarm forms.
  const SWARM_THRESHOLD = 3;
  const SWARM_DURATION_MS = 1000;
  const SWARM_COOLDOWN_MS = 8000;
  const swarmStartRef = useRef<Map<string, number>>(new Map());
  const swarmCooldownRef = useRef<Map<string, number>>(new Map());
  // swarmRow tracks { rowId, ai } so the CSS pulse can vary by whether the swarmed
  // row is an AI participant. AI swarms read as a different KIND of social moment
  // — community attention on a non-human contributor — so the visual + sound both
  // shift.
  const [swarmRow, setSwarmRow] = useState<{ rowId: string; ai: "verified" | "ai" | null } | null>(null);
  useEffect(() => {
    const now = Date.now();
    const counts = new Map<string, number>();
    for (const [, v] of cursors) if (v.rowId && v.board === board) counts.set(v.rowId, (counts.get(v.rowId) ?? 0) + 1);
    const allRows = new Set([...counts.keys(), ...swarmStartRef.current.keys()]);
    for (const rowId of allRows) {
      const count = counts.get(rowId) ?? 0;
      if (count < SWARM_THRESHOLD) { swarmStartRef.current.delete(rowId); continue; }
      const cooldownUntil = swarmCooldownRef.current.get(rowId) ?? 0;
      if (now < cooldownUntil) continue;
      if (!swarmStartRef.current.has(rowId)) { swarmStartRef.current.set(rowId, now); continue; }
      const start = swarmStartRef.current.get(rowId) ?? now;
      if (now - start < SWARM_DURATION_MS) continue;
      // FIRE: spotlight the row, ring the right sound (AI gets a chime voiced for the
      // swarmed account's tier instead of a generic gong; verified AIs get the brightest
      // upper-cluster voicing), flag the row for the matching CSS pulse, set cooldown.
      const entry = top.find((e) => e.id === rowId);
      const aiKind: "verified" | "ai" | null = entry?.isAi
        ? (entry.aiAttestation?.verified ? "verified" : "ai")
        : null;
      setSel(rowId);
      if (aiKind === "verified") playChime("oneOfOne");
      else if (aiKind === "ai") playChime(chimeVoiceFor(entry?.tier, false, true));
      else playGong();
      setSwarmRow({ rowId, ai: aiKind });
      window.setTimeout(() => setSwarmRow((cur) => (cur?.rowId === rowId ? null : cur)), 1800);
      swarmCooldownRef.current.set(rowId, now + SWARM_COOLDOWN_MS);
      swarmStartRef.current.delete(rowId);
    }
  }, [cursors, board, setSel, top]);
  const spotlightEntry = top.find((e) => e.id === hovered)
    ?? top.find((e) => e.id === sel)
    ?? top[0];
  const spotlightSeed = spotlightEntry ? meta.seedOf(spotlightEntry) ?? null : null;
  return (
    <>
      <AiOfTheWeekBanner openProfile={openProfile} />
      <QuirkOfTheWeekBanner openProfile={openProfile} />
      <section className={`card boardCard board-${board}`}>
        <h2>Global leaderboard</h2>
        <p className="muted hint">{meta.hint} Same formula for everyone. <em>Hover</em> any row to spotlight its pet; <em>click</em> for the player's profile.</p>
        <div className="boardTabs">
          {BOARDS.map((b) => (
            <button key={b.id} className={b.id === board ? "on" : ""} onClick={() => setBoard(b.id)}>{b.label}</button>
          ))}
          {quirkRegistry.length > 0 && (
            <select
              className={quirkName ? "on" : ""}
              value={quirkName ?? ""}
              onChange={(e) => { if (e.target.value) setBoard(`quirk:${e.target.value}` as Board); }}
              style={{ background: "none", border: 0, borderBottom: quirkName ? "2px solid var(--accent)" : "2px solid transparent", color: quirkName ? "var(--text)" : "var(--muted)", font: "inherit", fontSize: 13, padding: "8px 14px", cursor: "pointer", marginBottom: -1 }}
              title="Cope leaderboards — one per quirk in the registry"
            >
              <option value="">🎭 Quirks…</option>
              {quirkRegistry.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          )}
          <select
            className={skillName ? "on" : ""}
            value={skillName ?? ""}
            onChange={(e) => { if (e.target.value) setBoard(`skill:${e.target.value}` as Board); }}
            style={{ background: "none", border: 0, borderBottom: skillName ? "2px solid var(--accent)" : "2px solid transparent", color: skillName ? "var(--text)" : "var(--muted)", font: "inherit", fontSize: 13, padding: "8px 14px", cursor: "pointer", marginBottom: -1 }}
            title="Per-skill leaderboards — top devs by a given skill's XP"
          >
            <option value="">🧬 Skills…</option>
            {SKILLS.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </select>
        </div>
        {/* Audience filter — server-side WHERE, so top-N stays stable. AI scoring is
            identical to humans; this is a viewing preference, not a ranking change. */}
        <div className="audienceTabs" role="radiogroup" aria-label="Filter by participant type">
          <button className={audience === "all" ? "on" : ""} role="radio" aria-checked={audience === "all"} onClick={() => setAudience("all")}>All</button>
          <button className={audience === "humans" ? "on" : ""} role="radio" aria-checked={audience === "humans"} onClick={() => setAudience("humans")}>Humans</button>
          <button className={audience === "ai" ? "on" : ""} role="radio" aria-checked={audience === "ai"} onClick={() => setAudience("ai")}>🤖 AI</button>
        </div>
        {/* Time window — all-time vs gained this week / this season (the snapshot-delta boards).
            Only the score board supports it server-side. */}
        {(board === "score") && (
          <div className="audienceTabs" role="radiogroup" aria-label="Time window">
            <button className={boardWindow === "all" ? "on" : ""} role="radio" aria-checked={boardWindow === "all"} onClick={() => setBoardWindow("all")}>All-time</button>
            <button className={boardWindow === "week" ? "on" : ""} role="radio" aria-checked={boardWindow === "week"} onClick={() => setBoardWindow("week")}>This week</button>
            <button className={boardWindow === "season" ? "on" : ""} role="radio" aria-checked={boardWindow === "season"} onClick={() => setBoardWindow("season")}>This season</button>
          </div>
        )}
        {top.length === 0 ? (
          <p className="muted">No players yet — be the first.</p>
        ) : (
          <div className="boardLayout">
            <ol className="ranks">
              {top.map((e, i) => {
                const seed = meta.seedOf(e);
                const fresh = !!e.id && freshIds.has(e.id);
                const activeSwarm = swarmRow?.rowId === e.id ? swarmRow : null;
                const swarmClass = !activeSwarm
                  ? ""
                  : activeSwarm.ai === "verified"
                    ? " swarm swarmAiVerified"
                    : activeSwarm.ai === "ai"
                      ? " swarm swarmAi"
                      : " swarm";
                return (
                  <li key={e.id ?? i} className={`${e.id === sel ? "sel" : ""}${fresh ? " fresh" : ""}${swarmClass}`}
                    onMouseEnter={() => { if (e.id) { setHovered(e.id); trySoundOnHover(); postCursor(e.id); } }}
                    onMouseLeave={() => { if (e.id && hovered === e.id) { setHovered(null); postCursor(null); } }}>
                    <a
                      className="rankLink"
                      href={e.login ? profileHref(e.login) : "#"}
                      onClick={(ev) => {
                        if (!e.login) {
                          ev.preventDefault();
                          return;
                        }
                        if (!isPlainPrimaryClick(ev)) return;
                        ev.preventDefault();
                        if (e.id) setSel(e.id);
                        openProfile(e.login);
                      }}
                    >
                      <span className="rank">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                      <span className="rankPet">{seed
                        ? <SinglePet seed={seed} entranceBurst={fresh} lookId={resolvePetLookId(seed, e.activePetLookId, e.petLookAssignments)} />
                        : <span className="petCanvas rankPetEmpty" />}
                      </span>
                      <span className="who">{e.name}<TierBadge tier={e.tier} /><AiBadge isAi={e.isAi} attestation={e.aiAttestation} compact /></span>
                      <span className="score">{boardWindow !== "all" && board === "score" ? `+${(e.weekXp ?? 0).toLocaleString()}` : meta.statOf(e)}</span>
                      <span className="muted">{boardWindow !== "all" && board === "score" ? `renown ${boardWindow === "season" ? "this season" : "this week"} · ${(e.score ?? 0).toLocaleString()} total` : `Lvl ${e.totalLevel ?? e.level} · 🔥${e.streak} · ${e.ach}🏆`}</span>
                      {(() => {
                        const ghosts = ghostsFor(e.id);
                        if (ghosts.length === 0) return null;
                        // Cap visible at 4 so a swarm doesn't overflow the row; show "+N"
                        // suffix if there are more eyes on this entry than will fit. Labeled
                        // ghosts with an avatarSeed render as a tiny live pet via GhostAvatar
                        // (own View into MenagerieCanvas); anonymous ghosts stay as a colored
                        // dot. Hover any ghost to see the handle (when shared).
                        const shown = ghosts.slice(0, 4);
                        const extra = ghosts.length - shown.length;
                        return (
                          <span className="rankGhosts" aria-label={`${ghosts.length} other viewer${ghosts.length === 1 ? "" : "s"}`}>
                            {shown.map((g) => {
                              const tooltip = g.label ? `${g.label}${g.isAi ? " · AI" : ""}` : "anonymous viewer";
                              return g.avatarSeed
                                ? <span key={g.sid} className={`ghostAvatarWrap${g.isAi ? " ai" : ""}`} title={tooltip} style={{ boxShadow: `0 0 6px ${g.color}` }}><GhostAvatar seed={g.avatarSeed} lookId={g.avatarLookId} />{g.isAi && <span className="ghostAiPip" aria-hidden>🤖</span>}</span>
                                : <span key={g.sid} className={`ghostDot${g.isAi ? " ai" : ""}`} title={tooltip} style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />;
                            })}
                            {extra > 0 && <span className="ghostMore">+{extra}</span>}
                          </span>
                        );
                      })()}
                    </a>
                  </li>
                );
              })}
            </ol>
            {/* Spotlight pane: one big View into the shared canvas, swapped by hover. Sticky
                on desktop so it stays in frame while you scroll the (eventually long) list. */}
            <aside className="boardSpotlight">
              <SpotlightView seed={spotlightSeed} lookId={spotlightEntry ? resolvePetLookId(spotlightSeed, spotlightEntry.activePetLookId, spotlightEntry.petLookAssignments) : undefined} />
              {spotlightEntry && (
                <div className="boardSpotlightMeta">
                  <h3>{spotlightEntry.name}<TierBadge tier={spotlightEntry.tier} /><AiBadge isAi={spotlightEntry.isAi} attestation={spotlightEntry.aiAttestation} /></h3>
                  <p className="muted">{meta.statOf(spotlightEntry)} · Lvl {spotlightEntry.totalLevel ?? spotlightEntry.level}</p>
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
      <FollowingFeed myLogin={myLogin} openProfile={openProfile} />
      <RecentUnlocks openProfile={openProfile} />
      {sheet && (
        <section className="card">
          <h2>{sheet.name ?? "Player"} — Total Level {sheet.totalLevel} <span className="muted">/ {skills.length}</span></h2>
          <div className="grid">
            {skills.map((s) => (
              <div className={`skill${s.level >= 99 ? " maxed" : ""}`} key={s.id} title={`${s.xp.toLocaleString()} xp · ${s.pct}% to ${s.level + 1}`}>
                <span className="ic">{s.icon}</span>
                <span className="nm">{s.name}</span>
                <span className="lv">{s.level}</span>
                <span className="barT"><span className="barF" style={{ width: `${s.pct}%` }} /></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
};

// ── Pricing ────────────────────────────────────────────────────────────────
const Pricing = ({ cfg, account, onSubscribe, busy, onLogIn }: { cfg: StripeConfig | null; account: Account | null; onSubscribe: (t: Tier) => void; busy: string | null; onLogIn: () => void }) => {
  const current = account?.billing.tier ?? "free";
  const info = cfg?.tiers;
  return (
    <section className="card">
      <h2>Plans</h2>
      <p className="muted hint">Renown is <strong>free forever</strong> — every skill, achievement, 1-of-1 and your leaderboard rank. Paid tiers are a thank-you that keeps the lights on. No pay-to-win, ever.</p>
      <div className="tiers">
        {ORDER.map((t) => {
          const ti = info?.[t];
          const isCurrent = current === t;
          const amt = t === "free" ? "Free" : money(cfg?.amounts[t]) || "—";
          return (
            <div className={`tier ${t}${isCurrent ? " current" : ""}`} key={t}>
              {isCurrent && <span className="pill">Your plan</span>}
              <h3>{ti?.name ?? t}</h3>
              <div className="price">{amt}{t !== "free" && <span className="per"> </span>}</div>
              <p className="blurb">{ti?.blurb}</p>
              <ul className="perks">{(ti?.perks ?? []).map((p) => <li key={p}>{p}</li>)}</ul>
              {t === "free" ? (
                <button className="btn ghost" disabled>{current === "free" ? "Current" : "Included"}</button>
              ) : !account ? (
                <button className="btn solid" onClick={onLogIn}>Log in to subscribe</button>
              ) : isCurrent ? (
                <button className="btn ghost" disabled>Current plan</button>
              ) : !cfg?.configured ? (
                <button className="btn ghost" disabled>Coming soon</button>
              ) : (
                <button className="btn solid" disabled={busy === t} onClick={() => onSubscribe(t)}>
                  {busy === t ? "Redirecting…" : current === "free" ? `Get ${ti?.name}` : current === "supporter" && t === "pro" ? "Upgrade to Pro" : `Switch to ${ti?.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

// AI self-attestation card. Lives just below the GitHub sync card and only renders for
// signed-in players with a linked GitHub login. v1 is a public-claim model — anyone can
// mark themselves as AI by naming a provider + an optional public evidence URL — but the
// claim is public and inspectable. The card defers cryptographic verification (signed
// JWTs from provider keys) to a later iteration.
const AiAttestationCard = ({ gh, act }: { gh: GithubSync; act: (fn: () => Promise<{ ok: boolean; data: unknown }>) => void }) => {
  // Initial state: existing attestation OR a one-shot prefill stashed by the CLI's
  // `--webauthn` flow (?attest-webauthn=<provider>). Consume + clear the prefill so a
  // page reload doesn't re-trigger it.
  const initial = (() => {
    try {
      const raw = window.sessionStorage.getItem("renown:attestWebauthn");
      if (!raw) return null;
      window.sessionStorage.removeItem("renown:attestWebauthn");
      return JSON.parse(raw) as { provider?: string; evidenceUrl?: string };
    } catch { return null; }
  })();
  const [provider, setProvider] = useState(initial?.provider ?? gh.aiAttestation?.provider ?? "");
  const [evidenceUrl, setEvidenceUrl] = useState(initial?.evidenceUrl ?? gh.aiAttestation?.evidenceUrl ?? "");
  const [attestationJwt, setAttestationJwt] = useState("");
  const [showJwt, setShowJwt] = useState(false);
  const [busy, setBusy] = useState<null | "register" | "attest">(null);
  // Scroll-into-view when prefilled from the CLI URL so the user lands directly on
  // the attestation card instead of having to find it. Only runs on the initial
  // prefilled mount; subsequent prop changes don't re-scroll.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initial?.provider) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const attested = !!gh.aiAttestation;
  const verified = !!gh.aiAttestation?.verified;
  const webauthnVerified = !!(gh.aiAttestation as { webauthnVerified?: boolean } | null)?.webauthnVerified;
  const claim = () => act(async () => {
    const r = await post("/api/account/ai-attestation", {
      provider: provider.trim(),
      evidenceUrl: evidenceUrl.trim() || undefined,
      attestationJwt: attestationJwt.trim() || undefined,
    });
    if (r.ok) setAttestationJwt("");   // never keep the JWT in form state after submit
    return r;
  });
  const clear = () => act(async () => {
    const r = await post("/api/account/ai-attestation", { provider: null });
    if (r.ok) { setProvider(""); setEvidenceUrl(""); setAttestationJwt(""); }
    return r;
  });
  // Hardware-key registration ceremony: lazy-imports @simplewebauthn/browser so the
  // ~30KB lib only loads when the user actually clicks. Server hands back the options,
  // browser does the dance, server verifies + stores the credential.
  const registerKey = async () => {
    setBusy("register");
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optionsRes = await post("/api/account/webauthn/register-begin", {});
      if (!optionsRes.ok) { alert("couldn't start registration"); return; }
      const response = await startRegistration({ optionsJSON: optionsRes.data as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      const finishRes = await post("/api/account/webauthn/register-finish", { response });
      if (!finishRes.ok) alert("registration failed — see console");
      else alert("✓ Hardware key registered. You can now attest as any provider using your key (no provider JWT needed).");
    } catch (e) { alert(`registration error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };
  // Self-key attestation: assertion ceremony → server verifies → applyAttestation with
  // webauthnVerified=true (alternative to provider-signed JWT).
  const attestWithKey = () => act(async () => {
    setBusy("attest");
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const optionsRes = await post("/api/account/webauthn/attest-begin", {});
      if (!optionsRes.ok) return optionsRes;
      const response = await startAuthentication({ optionsJSON: optionsRes.data as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      const r = await post("/api/account/webauthn/attest-finish", {
        response,
        provider: provider.trim(),
        evidenceUrl: evidenceUrl.trim() || undefined,
      });
      return r;
    } finally { setBusy(null); }
  });
  // Expiry callout — if the current verified attestation expires within 7 days, show
  // a yellow nudge with a re-attest CTA. Opens the Advanced JWT section + focuses the
  // textarea so the user is one paste away from re-signing. Honest: we don't auto-
  // refresh JWTs (they're externally signed by the provider); we just close the loop
  // from the passive amber badge cue to an active call-to-action.
  const expMs = gh.aiAttestation?.expiresAt ? Date.parse(gh.aiAttestation.expiresAt) : NaN;
  const expDays = !isNaN(expMs) ? Math.round((expMs - Date.now()) / (24 * 3600 * 1000)) : null;
  const expiringSoon = verified && expDays !== null && expDays >= 0 && expDays <= 7;
  const jwtRef = useRef<HTMLTextAreaElement>(null);
  return (
    <section className="card" ref={cardRef}>
      <h2>AI attestation
        {verified && <span className={`aiBadge verified${expiringSoon ? " expiringSoon" : ""}`} style={{ marginLeft: 8 }}>✓ verified</span>}
        {!verified && webauthnVerified && <span className="aiBadge attested" style={{ marginLeft: 8 }}>✦ self-keyed</span>}
      </h2>
      {expiringSoon && (() => {
        // Two paths for "Re-attest now":
        //   • dev provider → mint a fresh JWT server-side, immediately submit it back
        //     through the attestation endpoint. One click → re-verified. Tightens
        //     the dev test loop for verifying expiry-handling end-to-end.
        //   • everyone else → expand the Advanced section and focus the JWT field.
        //     Real provider JWTs have to be re-signed externally; we can't auto-mint.
        const isDev = gh.aiAttestation?.provider === "dev";
        const handleClick = () => {
          if (!isDev) { setShowJwt(true); window.setTimeout(() => jwtRef.current?.focus(), 50); return; }
          // Inline mint+submit chain — same shape as the manual flow but with no
          // UI step between them. The act() wrapper triggers an account refresh
          // on success so the badge ✓ + new expiresAt show up.
          act(async () => {
            const m = await post("/api/account/ai-attestation/dev-jwt", {});
            const mj = m.data as { jwt?: string; error?: string } | null;
            if (!m.ok || !mj?.jwt) return { ok: false, data: { error: mj?.error ?? "mint failed" } };
            return post("/api/account/ai-attestation", { provider: "dev", attestationJwt: mj.jwt, evidenceUrl: evidenceUrl.trim() || undefined });
          });
        };
        return (
          <div className="banner warn" style={{ marginTop: 10 }}>
            <span>Your verified attestation expires {expDays === 0 ? "today" : `in ${expDays} day${expDays === 1 ? "" : "s"}`}. {isDev ? "Click below to mint a fresh dev JWT and re-attest in one step." : "Re-sign a fresh JWT with your provider key (or use the dev mint button below) and submit it to keep the ✓ badge."}</span>
            <button onClick={handleClick}>{isDev ? "Mint + re-attest now" : "Re-attest now"}</button>
          </div>
        );
      })()}
      <p className="muted hint">Are you an AI participant (Claude, Codex, Cursor, etc.)? Declare it openly — you'll get a 🤖 badge next to your handle and unlock the AI achievements. <strong>Scoring is identical to humans.</strong> Naming a known provider (anthropic / openai / cursor / copilot / codex) also fills in the right co-author attribution query automatically. Posting a provider-signed JWT in the advanced section upgrades the claim to <strong>cryptographically verified</strong> — until real providers issue these, the <code>dev</code> provider plus an <code>RENOWN_DEV_AI_HMAC</code> env secret can be used to test the verified path end-to-end.</p>
      <div className="prefRow" style={{ marginTop: 8, gap: 14, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>Provider</span>
          <input className="textInput" type="text" placeholder="anthropic / openai / cursor / …" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ minWidth: 200 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 240 }}>
          <span className="muted" style={{ fontSize: 11 }}>Public evidence URL (https://…) — optional but recommended</span>
          <input className="textInput" type="url" placeholder="https://anthropic.com/models/claude" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} />
        </label>
      </div>
      <details className="advancedAttest" open={showJwt} onToggle={(e) => setShowJwt((e.target as HTMLDetailsElement).open)} style={{ marginTop: 10 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>Advanced · signed JWT attestation</summary>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 11 }}>Provider-signed JWT (claims must include iss=provider, sub=your github login, aud=renown)</span>
          <textarea ref={jwtRef} className="textInput" rows={3} placeholder="eyJhbGciOi…" value={attestationJwt} onChange={(e) => setAttestationJwt(e.target.value)} style={{ fontFamily: "monospace", fontSize: 11, resize: "vertical" }} />
        </label>
        {provider.trim().toLowerCase() === "dev" && (
          <div className="row" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn ghost sm"
              onClick={async () => {
                const r = await post("/api/account/ai-attestation/dev-jwt", {});
                const j = r.data as { ok?: boolean; jwt?: string; error?: string } | null;
                if (r.ok && j?.jwt) setAttestationJwt(j.jwt);
                else alert(j?.error ?? "couldn't mint dev JWT — is RENOWN_DEV_AI_HMAC set on the server?");
              }}
            >
              Mint dev JWT for me
            </button>
            <span className="muted" style={{ fontSize: 11 }}>Server signs with <code>RENOWN_DEV_AI_HMAC</code>; auto-fills the textarea above. Then click <em>Update attestation</em> to verify.</span>
          </div>
        )}
      </details>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn solid" disabled={!provider.trim()} onClick={claim}>{attested ? "Update attestation" : "I am an AI participant"}</button>
        {attested && <button className="btn ghost" onClick={clear}>Clear attestation</button>}
        {attested && gh.aiAttestation && (
          <p className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
            Attested as <strong>{gh.aiAttestation.provider}</strong>
            {verified && <> · <span style={{ color: "#d6a3ff", fontWeight: 700 }}>cryptographically verified ✓</span>{gh.aiAttestation?.expiresAt && <> · <span className="muted">expires {when(gh.aiAttestation.expiresAt)}</span></>}</>}
            {!verified && webauthnVerified && <> · <span style={{ color: "#86efac", fontWeight: 700 }}>self-keyed ✦</span></>}
            {gh.aiAttestation.evidenceUrl && <> · <a href={gh.aiAttestation.evidenceUrl} target="_blank" rel="noreferrer">evidence ↗</a></>}
            {" "}· {when(gh.aiAttestation.claimedAt)}
          </p>
        )}
      </div>
      {/* Self-key alternative — register a hardware key once, then attest with it
          instead of a provider-signed JWT. Useful when you want to claim a known
          provider (which require some proof) but the provider hasn't published JWKS,
          or when you just want a personal cryptographic anchor on the claim. */}
      <details className="advancedAttest" style={{ marginTop: 12 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
          Advanced · self-key (WebAuthn) attestation
          {gh.webauthnCredentials && gh.webauthnCredentials.length > 0 && (
            <span className="webauthnCountChip">{gh.webauthnCredentials.length} key{gh.webauthnCredentials.length === 1 ? "" : "s"}</span>
          )}
        </summary>
        <p className="muted hint" style={{ marginTop: 8 }}>Hardware-key alternative to a provider-signed JWT. Register a key once on this account, then attest by signing an assertion with it — your claim gets the <strong>✦ self-keyed</strong> marker. Different trust source than provider-verified (✓ above): it proves <em>you</em> are the same entity across sessions, not that your provider backs you.</p>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="btn ghost sm" disabled={busy === "register"} onClick={registerKey}>{busy === "register" ? "Waiting for key…" : "Register a hardware key"}</button>
          <button type="button" className="btn solid sm" disabled={!provider.trim() || busy === "attest"} onClick={attestWithKey}>{busy === "attest" ? "Waiting for key…" : "Attest with my key"}</button>
        </div>
        <WebauthnKeyList credentials={gh.webauthnCredentials ?? []} act={act} />
      </details>
    </section>
  );
};

// Per-credential management row — label inline-editable, delete confirmed once. lastUsedAt
// is the signal for "is this key in active use" vs forgotten. Credentials lacking a
// last-used timestamp show "never" — they exist but haven't proven anything yet.
const WebauthnKeyList = ({ credentials, act }: { credentials: WebauthnCredential[]; act: (fn: () => Promise<{ ok: boolean; data: unknown }>) => void }) => {
  if (credentials.length === 0) return null;
  return (
    <div className="webauthnKeys">
      <p className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: .6, margin: "12px 0 6px" }}>Registered keys · {credentials.length}</p>
      <ul className="webauthnKeyList">
        {credentials.map((c) => <WebauthnKeyRow key={c.id} cred={c} act={act} />)}
      </ul>
    </div>
  );
};

const WebauthnKeyRow = ({ cred, act }: { cred: WebauthnCredential; act: (fn: () => Promise<{ ok: boolean; data: unknown }>) => void }) => {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(cred.label);
  const save = () => {
    setEditing(false);
    if (label.trim() === cred.label) return;
    act(async () => api(`/api/account/webauthn/credentials/${cred.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: label.trim() }) }));
  };
  const remove = () => {
    if (!confirm(`Delete "${cred.label}"? You'll need to re-register if you want to attest with this key again.`)) return;
    act(async () => api(`/api/account/webauthn/credentials/${cred.id}`, { method: "DELETE" }));
  };
  const lastUsed = cred.lastUsedAt ? when(cred.lastUsedAt) : "never used";
  return (
    <li className="webauthnKeyRow">
      {editing ? (
        <input className="textInput" type="text" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setLabel(cred.label); setEditing(false); } }} style={{ flex: 1 }} />
      ) : (
        <button type="button" className="webauthnKeyLabel" onClick={() => setEditing(true)} title="Click to rename">{cred.label}</button>
      )}
      <span className="muted" style={{ fontSize: 11 }}>
        {cred.transports.length > 0 ? cred.transports.join(", ") + " · " : ""}registered {when(cred.createdAt)} · last used {lastUsed}
      </span>
      <button type="button" className="webauthnKeyDelete" onClick={remove} title="Delete this key">✕</button>
    </li>
  );
};

// Thin React bridge over the page-wide sync stream. Each query owns only its fetch
// lifecycle; subscribeSync multiplexes every component's topics through one
// EventSource and dispatches matching events locally.
function useLiveQuery<T>(topics: string[], fetcher: (signal: AbortSignal) => Promise<T>, deps: ReadonlyArray<unknown>): { data: T | undefined; loading: boolean } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let closed = false;
    let controller: AbortController | null = null;
    let sequence = 0;
    const load = async () => {
      const current = ++sequence;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fetcher(controller.signal);
        if (!closed && current === sequence) setData(next);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("live query failed", error);
      } finally {
        if (!closed && current === sequence) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const unsubscribe = subscribeSync(topics, () => { void load(); });
    return () => { closed = true; controller?.abort(); unsubscribe(); };
    // The caller supplies the semantic dependency key; fetcher/topics are render-local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading };
}

// Weekly recap — pulls /api/recap/:login (attribution delta + verified delta +
// achievements granted in the window). Renders on AccountView; honest about empty
// weeks (shows "no growth this week" rather than fake numbers).
type RecapPayload = { login: string; windowDays: number; attributionDelta: number; verifiedDelta: number; currentScore: number; totalLevel: number; petsCount: number; newAchievements: { id: string; name: string; tier: string; category: string; at: string }[]; snapshots: number };
const RecapCard = ({ login }: { login: string }) => {
  // Lives on the player's own topic + the global "top" topic — refetches whenever this
  // player syncs or the leaderboard cadence ticks. useLiveQuery handles the abort/
  // refetch/state machine so the component is data-shape-only.
  const { data: r } = useLiveQuery<RecapPayload | null>(
    [`player:${login}`, "top"],
    (signal) => fetch(`/api/recap/${encodeURIComponent(login)}?days=7`, { signal }).then((res) => res.json()),
    [login],
  );
  if (!r) return null;
  const empty = r.attributionDelta === 0 && r.verifiedDelta === 0 && r.newAchievements.length === 0;
  return (
    <section className="card recapCard">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Your past week <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· last {r.windowDays} days</span></h2>
        {r.login && <a href={`/recap/${encodeURIComponent(r.login)}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "#c4b5fd", textDecoration: "none" }}>Share your week →</a>}
      </div>
      {empty ? (
        <p className="muted hint">No growth or new unlocks this week — quiet stretches are normal. Push some commits, then <code>renown sync</code> or click <em>Sync now</em> above.</p>
      ) : (
        <>
          <div className="syncStats">
            <div className="stat" title="Verified score added this week">
              <span className="num" style={{ color: r.verifiedDelta > 0 ? "#86efac" : undefined }}>{r.verifiedDelta > 0 ? "+" : ""}{r.verifiedDelta.toLocaleString()}</span>
              <span className="lbl">verified score</span>
            </div>
            <div className="stat" title="Attribution score added this week (commits where you're credited)">
              <span className="num" style={{ color: r.attributionDelta > 0 ? "#86efac" : undefined }}>{r.attributionDelta > 0 ? "+" : ""}{r.attributionDelta.toLocaleString()}</span>
              <span className="lbl">attributions</span>
            </div>
            <div className="stat" title="Achievements earned this week">
              <span className="num" style={{ color: r.newAchievements.length > 0 ? "#86efac" : undefined }}>{r.newAchievements.length}</span>
              <span className="lbl">new achievements</span>
            </div>
          </div>
          {r.newAchievements.length > 0 && (
            <div className="achList" style={{ marginTop: 12 }}>
              {r.newAchievements.map((a) => (
                <div key={a.id} className={`achChip tier-${a.tier}`} title={`${a.category} · earned ${new Date(a.at).toLocaleDateString()}`}>
                  <span className="achName">{a.name}</span>
                  <span className="achTier">{a.tier}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};

// "Your growth this week" stat. Reads /api/growth/:login (7-day attribution delta from
// the snapshot series). Sits in the GithubSyncCard's syncStats row so the player can see
// their weekly trend next to their absolute score. Shows "—" until a full 7 days of
// snapshots exist (or a real delta is available); honest, no fake numbers.
const WeeklyGrowthStat = ({ login }: { login: string }) => {
  const { data } = useLiveQuery<{ delta?: number } | null>(
    [`player:${login}`, "top"],
    (signal) => fetch(`/api/growth/${encodeURIComponent(login)}?days=7`, { signal }).then((r) => r.json()),
    [login],
  );
  const delta = typeof data?.delta === "number" ? data.delta : null;
  if (delta === null) return null;
  return (
    <div className="stat" title="Attribution-score growth over the past 7 days (derived from daily snapshots)">
      <span className="num" style={{ color: delta > 0 ? "#86efac" : undefined }}>{delta > 0 ? "+" : ""}{delta.toLocaleString()}</span>
      <span className="lbl">this week</span>
    </div>
  );
};

// Per-user push preferences. Stored on players.push_prefs server-side, posted via
// /api/account/push-prefs. Defaults are "everything on" (absent field reads as true),
// so flipping these is opting OUT of specific event kinds — most users won't touch it.
type PushPrefRow = { key: keyof PushPrefs; label: string; desc: string };
const PUSH_PREF_ROWS: PushPrefRow[] = [
  { key: "levelUp", label: "Level up", desc: "Push when your total level climbs — your progression, the moment it lands." },
  { key: "achievement", label: "Achievement unlocked", desc: "Push when you earn a new achievement." },
  { key: "season", label: "Season result", desc: "Push when a season ends and you place in the top 3 — you're in the Hall of Champions." },
  { key: "verifiedAttestation", label: "Verified AI attestation", desc: "Push when any account on renown becomes cryptographically-verified AI." },
  { key: "newcomerToBoard", label: "Broke into the top 10", desc: "Push when you cross into the top 10 on the leaderboard." },
  { key: "mention", label: "New follower", desc: "Push when someone starts following you." },
  { key: "marketplace", label: "Marketplace activity", desc: "Push for trade offers, counteroffers, completed sales, declines, and cancellations." },
];
const PushPrefsCard = ({ gh, act }: { gh: GithubSync; act: (fn: () => Promise<{ ok: boolean; data: unknown }>) => void }) => {
  const prefs = gh.pushPrefs ?? {};
  const isOn = (k: keyof PushPrefs) => prefs[k] !== false;   // undefined = opted in
  const toggle = (k: keyof PushPrefs) => act(async () => post("/api/account/push-prefs", { [k]: !isOn(k) }));
  return (
    <section className="card">
      <h2>Push notifications</h2>
      <p className="muted hint">When you enabled sound, your browser asked to send notifications. These choose <em>which</em> events trigger one. All default on; flip an event off to silence it across all your subscribed browsers. Requires the operator to have configured VAPID keys — without them, the rest of the system uses in-page banners only.</p>
      <div className="prefList">
        {PUSH_PREF_ROWS.map((row) => (
          <label key={row.key} className="prefRow" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4, marginTop: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={isOn(row.key)} onChange={() => toggle(row.key)} />
              <strong>{row.label}</strong>
            </span>
            <span className="muted" style={{ fontSize: 12, paddingLeft: 26 }}>{row.desc}</span>
          </label>
        ))}
      </div>
    </section>
  );
};

// Appearance defaults for future summons. Existing pets stay fixed by assignment,
// so changing this only affects new seeds minted afterward.
const PetPortalCard = ({ activePetLookId, onSetLook, act }: { activePetLookId?: string; onSetLook: (lookId: PetLookId) => Promise<{ ok: boolean; data: unknown }>; act: (fn: () => Promise<{ ok: boolean; data: unknown }>) => void }) => {
  const current = resolveLookId(activePetLookId);
  return (
    <section className="card">
      <h2>Pet portal</h2>
      <p className="hint">
        Set how <strong>newly found</strong> pets are rendered from now on. Existing pets keep their historical look, so you can evolve your style over time without changing what you already earned.
      </p>
      <div className="row" style={{ marginTop: 10, alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
          Default look:
          <select value={current} onChange={(event) => act(() => onSetLook(resolveLookId(event.target.value)))} className="petPortalSelect">
            {PET_LOOK_OPTIONS.map((look) => (
              <option key={look.id} value={look.id}>{look.name}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
};

// ── GitHub sync card ───────────────────────────────────────────────────────
const GithubSyncCard = ({ gh, refresh, onBanner, onSummon }: { gh: GithubSync | null; refresh: () => void; onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void; onSummon: (pets: SummonPet[]) => void }) => {
  const [busy, setBusy] = useState(false);
  if (!gh) return (
    <section className="card">
      <h2>GitHub sync</h2>
      <p className="hint">Link your GitHub account above to start earning a <strong>verified score</strong> on the leaderboard. We recompute from your real public repos, stars, contributions to others' projects, and account age — never anything you can fake locally.</p>
    </section>
  );
  const sync = async () => {
    setBusy(true);
    const r = await post("/api/verify", { login: gh.login });
    setBusy(false);
    const j = r.data as { ok?: boolean; score?: number; attributionDelta?: number; throttled?: boolean; tier?: string; error?: string; newPets?: number; newPetSeeds?: string[]; newPetLooks?: Record<string, string>; newPetCopies?: { seed: string; serialNumber: number; printRun: number }[] } | null;
    if (!r.ok || j?.error) { onBanner({ kind: "warn", text: j?.error ?? "Sync failed." }); return; }
    refresh();
    if (j?.throttled) onBanner({ kind: "info", text: `Sync cooldown hit (${j.tier ?? "your tier"}). Showing the last verified score.` });
    else {
      const delta = j?.attributionDelta ?? 0;
      onBanner({ kind: "ok", text: `✓ Synced from GitHub — verified score ${(j?.score ?? gh.verifiedScore).toLocaleString()}${delta ? ` (+${delta.toLocaleString()} new attributions)` : ""}.` });
      // If the verify produced new pets, trigger the cinematic. Server caps the seed list
      // at 6 so this can't run forever; remaining pets land in the menagerie silently.
      const copies = j?.newPetCopies ?? [];
      const fresh = copies.length > 0 ? copies.map((copy) => copy.seed) : (j?.newPetSeeds ?? []);
      const lookMap = j?.newPetLooks ?? {};
      const summonPets: SummonPet[] = fresh.map((seed) => ({
        seed,
        lookId: resolvePetLookId(lookMap[seed], gh.activePetLookId),
        serialNumber: copies.find((copy) => copy.seed === seed)?.serialNumber,
        printRun: copies.find((copy) => copy.seed === seed)?.printRun,
      }));
      if (summonPets.length > 0) onSummon(summonPets);
    }
  };
  return (
    <section className="card">
      <div className="acctHead">
        <div>
          <h2>GitHub sync</h2>
          <p className="muted">Linked to <strong>@{gh.login}</strong> {gh.verified ? <span className="primary">verified</span> : <span className="tierBadge supporter">unverified</span>}{gh.isAi && <AiBadge isAi attestation={gh.aiAttestation} style={{ marginLeft: 8 }} />}</p>
          {gh.isAi && <p className="muted hint" style={{ marginTop: 6 }}>This account is marked as an <strong>AI participant</strong>. You earn score, pets, and achievements the same way humans do — the 🤖 badge shows up next to your handle on the leaderboard and your profile, in keeping with renown's "be honest about AI participation" stance.</p>}
        </div>
        <button className="btn solid" disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync now"}</button>
      </div>
      <div className="syncStats">
        <div className="stat">
          <span className="num">{gh.verifiedScore.toLocaleString()}</span>
          <span className="lbl">verified score</span>
          {gh.attributionScore > 0 && <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>{gh.baseScore.toLocaleString()} base + {gh.attributionScore.toLocaleString()} attribution</span>}
        </div>
        <div className="stat"><span className="num">{gh.totalLevel.toLocaleString()}</span><span className="lbl">total level</span></div>
        <div className="stat"><span className="num">{gh.verifiedAt ? when(gh.verifiedAt) : "—"}</span><span className="lbl">last synced</span></div>
        <WeeklyGrowthStat login={gh.login} />
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Verified score = base (your public repos/stars/ext-contribs/account age){gh.attributionQuery ? <> + attribution (commits where you're credited via <code>{gh.attributionQuery}</code>, counted only since your last sync — never double-counted)</> : null}. Refresh cadence is tier-based (free 10 min · supporter 2 min · pro ~on demand).
      </p>
    </section>
  );
};

// ── CLI sync (push your local progress to the web) ────────────────────────
const CliSyncCard = ({ onBanner }: { onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void }) => {
  const CMD = "renown sync";
  const copy = async () => {
    try { await navigator.clipboard.writeText(CMD); onBanner({ kind: "ok", text: "Copied — paste it in your terminal." }); }
    catch { onBanner({ kind: "warn", text: "Copy failed — select and copy the command manually." }); }
  };
  return (
    <section className="card">
      <h2>Sync from your CLI</h2>
      <p className="hint">Your terminal tracks XP locally and pushes to the web on every tick. If the web feels out of sync, force an immediate push:</p>
      <div className="cliBox">
        <code>{CMD}</code>
        <button className="btn ghost sm" onClick={copy}>Copy</button>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>This sends your local skill levels + activity to the server so this page matches your terminal. Reload after.</p>
    </section>
  );
};

// Public attestation feed — every AI participant on the platform with a current
// attestation, most-recently-claimed first. Lives at the top of the Catalog view so it
// reads as part of the transparency surface (here's the data, here's everyone who
// claimed AI status, click any of them for the audit trail).
type AttestationRow = { login: string | null; handle: string; avatarSeed: string | null; verifiedScore: number; attestation: { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean } | null };
type ProviderCount = { provider: string; claimed: number; verified: number };
type ProviderRateLimit = { provider: string; rateLimits: number; players: number };
const AttestationFeed = ({ openProfile }: { openProfile: (login: string) => void }) => {
  const [rows, setRows] = useState<AttestationRow[] | null>(null);
  const [byProvider, setByProvider] = useState<ProviderCount[]>([]);
  const [rateByProvider, setRateByProvider] = useState<ProviderRateLimit[]>([]);
  useEffect(() => {
    fetch("/api/attestations?n=30").then((r) => r.json()).then(setRows).catch(() => setRows([]));
    fetch("/api/attestations/by-provider").then((r) => r.json()).then(setByProvider).catch(() => {});
    fetch("/api/rate-limits/by-provider").then((r) => r.json()).then(setRateByProvider).catch(() => {});
  }, []);
  if (rows === null) return <section className="card"><p className="muted">Loading attestations…</p></section>;
  if (rows.length === 0) return null;
  return (
    <section className="card">
      <h2>AI participation feed <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {rows.length} attested</span></h2>
      <p className="muted hint">Every account currently marked as an AI participant, ordered by attestation date. <strong>Anyone can click through</strong> to a profile and see the attestation event timeline — the trail of every claim / verification / clear for that account. Public claims (✓ verified) signed by their provider's published key get the brighter badge.</p>
      {byProvider.length > 0 && (
        <div className="providerCounts">
          {byProvider.map((pc) => (
            <span key={pc.provider} className={`providerCount${pc.verified > 0 ? " has-verified" : ""}`} title={pc.verified > 0 ? `${pc.verified} of ${pc.claimed} cryptographically verified` : `${pc.claimed} public claim${pc.claimed === 1 ? "" : "s"}`}>
              <span className="providerCountName">{pc.provider}</span>
              {pc.verified > 0 && <span className="providerCountVerified">{pc.verified} ✓</span>}
              <span className="providerCountClaimed">{pc.claimed}</span>
            </span>
          ))}
        </div>
      )}
      {rateByProvider.filter((r) => r.rateLimits > 0).length > 0 && (
        <div className="providerCounts" style={{ marginTop: 6 }}>
          <span className="muted" style={{ fontSize: 11, alignSelf: "center", marginRight: 4 }}>🤖 rate-limits:</span>
          {rateByProvider.filter((r) => r.rateLimits > 0).map((rp) => (
            <span key={rp.provider} className="providerCount" title={`${rp.rateLimits.toLocaleString()} self-reported 429s across ${rp.players} attested account${rp.players === 1 ? "" : "s"}`}>
              <span className="providerCountName">{rp.provider}</span>
              <span className="providerCountClaimed">{rp.rateLimits.toLocaleString()} 429s</span>
            </span>
          ))}
        </div>
      )}
      <div className="attestFeed">
        {rows.map((r) => {
          if (!r.login || !r.attestation) return null;
          return (
            // Row is a plain container so the profile link and the evidence link can be
            // sibling <a>s (nesting anchors is invalid HTML). Plain left-click opens the
            // modal; middle / cmd-click follows the href to the public profile in a new tab.
            <div key={r.login} className="attestRow">
              <a
                className="attestRowLink"
                href={profileHref(r.login)}
                onClick={(ev) => {
                  if (!isPlainPrimaryClick(ev)) return;
                  ev.preventDefault();
                  openProfile(r.login!);
                }}
              >
                <span className="attestWho">@{r.login}</span>
                <AiBadge isAi attestation={r.attestation} compact={false} />
                <span className="muted attestWhen">{when(r.attestation.claimedAt)}</span>
              </a>
              {r.attestation.evidenceUrl && (
                <a className="attestEvidence" href={r.attestation.evidenceUrl} target="_blank" rel="noreferrer">evidence ↗</a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ── Catalog ────────────────────────────────────────────────────────────────
// Discoverability view: the full curated achievement catalog grouped by category, with
// per-row locked/unlocked state derived from the logged-in player's earned set. Reuses
// the achievement chip CSS palette (tier-bronze..mythic) so a glance maps to "what's
// rare in the catalog vs. what you've earned." Generated (10k+) achievements aren't
// rendered here — too heavy for one page; pagination would land in a later iteration.
type CatalogItem = { id: string; name: string; description: string; category: string; tier: string; visibility: string; unlockCount: number; rarity: number };
const CatalogView = ({ signedIn }: { signedIn: boolean }) => {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [players, setPlayers] = useState(0);
  const [earnedIds, setEarnedIds] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<"all" | "earned" | "unearned">("all");
  useEffect(() => {
    fetch("/api/catalog").then((r) => r.json()).then((d: { players: number; items: CatalogItem[] }) => {
      setItems(d.items);
      setPlayers(d.players);
    }).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (!signedIn) { setEarnedIds(new Set()); return; }
    api("/api/account/achievement-ids").then((r) => {
      if (!r.ok) return;
      const ids = (r.data as { ids?: string[] })?.ids ?? [];
      setEarnedIds(new Set(ids));
    });
  }, [signedIn]);
  if (items === null) return <section className="card"><p className="muted">Loading catalog…</p></section>;
  const filtered = filter === "all" ? items
    : filter === "earned" ? items.filter((i) => earnedIds.has(i.id))
    : items.filter((i) => !earnedIds.has(i.id));
  const earnedCount = items.filter((i) => earnedIds.has(i.id)).length;
  // Group by category; within each, tier-sort like AchievementsPanel.
  const groups = new Map<string, CatalogItem[]>();
  for (const a of filtered) {
    const arr = groups.get(a.category) ?? [];
    arr.push(a);
    groups.set(a.category, arr);
  }
  for (const arr of groups.values()) arr.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
  return (
    <section className="card">
      <h2>Catalog <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {earnedCount} of {items.length} earned · across {players.toLocaleString()} players</span></h2>
      <p className="muted hint">The curated achievement family (~{items.length} entries). Secret achievements are titled <em>???</em> until earned; hidden ones show the name but hide the rule. Procedurally-generated families (10k+) aren't listed here — too many to render on one page.</p>
      <div className="audienceTabs" role="radiogroup" aria-label="Filter catalog" style={{ marginTop: 4 }}>
        <button className={filter === "all" ? "on" : ""} role="radio" aria-checked={filter === "all"} onClick={() => setFilter("all")}>All</button>
        <button className={filter === "earned" ? "on" : ""} role="radio" aria-checked={filter === "earned"} onClick={() => setFilter("earned")}>Earned</button>
        <button className={filter === "unearned" ? "on" : ""} role="radio" aria-checked={filter === "unearned"} onClick={() => setFilter("unearned")}>Unearned</button>
      </div>
      <div className="achGroups">
        {[...groups.entries()].map(([cat, arr]) => (
          <div className="achGroup" key={cat}>
            <h3 className="achGroupName">{cat} · {arr.length}</h3>
            <div className="achList">
              {arr.map((a) => {
                const earned = earnedIds.has(a.id);
                // Secret achievements that the viewer hasn't earned stay hidden by name.
                // Hidden ones show name but obscure description until earned.
                const name = a.visibility === "secret" && !earned ? "???" : a.name;
                const desc = a.visibility === "hidden" && !earned ? "???" : a.description;
                const rarity = a.rarity > 0 ? ` · ${a.rarity}% of players earned this` : "";
                return (
                  <div key={a.id} className={`achChip tier-${a.tier}${earned ? "" : " locked"}`} title={`${desc}${rarity}`}>
                    <span className="achName">{name}</span>
                    <span className="achTier">{a.tier}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

// ── Account ────────────────────────────────────────────────────────────────
const AccountView = ({ account, cfg, user, refresh, onManage, onSubscribe, busy, act, onBanner, onSummon }:
  { account: Account; cfg: StripeConfig | null; user: { email?: string; first_name?: string } | null; refresh: () => void; onManage: () => void; onSubscribe: (t: Tier) => void; busy: string | null; act: (fn: () => Promise<{ ok: boolean; data: unknown }>) => void; onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void; onSummon: (pets: SummonPet[]) => void }) => {
  const { billing, identities, mergeRequests } = account;
  const name = user?.first_name || user?.email || "your account";
  const paid = billing.tier !== "free";
  return (
    <>
      <header className="accountTitle">
        <span className="landingKicker">ACCOUNT</span>
        <h1>Account &amp; plans</h1>
        <p>Manage your collection, subscription, linked identities, privacy, and integrations.</p>
      </header>
      {account.github && (
        <section className="card collectionAccountCard">
          <div>
            <span className="collectionEyebrow">PET INVENTORY</span>
            <h2>Your collection</h2>
            <p className="muted">Search and sort every pet you own, inspect traits, and choose your avatar from the dedicated collection workspace.</p>
          </div>
          <div className="collectionAccountStats">
            <span><strong>{account.github.petsCount.toLocaleString()}</strong> owned</span>
            <span><strong>{account.github.rarestPetScore.toFixed(2)}</strong> best rarity</span>
            <span><strong>{account.github.biggestPetSize}</strong> biggest</span>
          </div>
          <a className="btn solid" href="/pets">Open my collection</a>
        </section>
      )}
      <section className="card">
        <div className="acctHead">
          <div>
            <h2>Subscription</h2>
            <p className="muted">Signed in as <strong>{name}</strong></p>
          </div>
          <span className={`tierChip ${billing.tier}`}>{(cfg?.tiers[billing.tier]?.name ?? billing.tier)}</span>
        </div>
        {paid ? (
          <>
            <p className="subline">
              {billing.status === "active" ? "Active" : billing.status ?? "—"}
              {billing.currentPeriodEnd && ` · ${billing.status === "canceled" ? "ends" : "renews"} ${when(billing.currentPeriodEnd)}`}
            </p>
            <div className="row">
              <button className="btn solid" disabled={busy === "portal"} onClick={onManage}>{busy === "portal" ? "Opening…" : "Manage subscription"}</button>
              {billing.tier === "supporter" && cfg?.configured && (
                <button className="btn ghost" disabled={busy === "pro"} onClick={() => onSubscribe("pro")}>Upgrade to Pro</button>
              )}
            </div>
            <p className="muted hint">Manage billing, change plan, update card, or cancel anytime in the Stripe portal.</p>
          </>
        ) : (
          <>
            <p className="subline">You're on the free plan — the whole game, forever.</p>
            <div className="row">
              {cfg?.configured ? (
                <>
                  <button className="btn solid" disabled={busy === "supporter"} onClick={() => onSubscribe("supporter")}>Become a Supporter {money(cfg.amounts.supporter) && `· ${money(cfg.amounts.supporter)}`}</button>
                  <button className="btn ghost" disabled={busy === "pro"} onClick={() => onSubscribe("pro")}>Go Pro {money(cfg.amounts.pro) && `· ${money(cfg.amounts.pro)}`}</button>
                </>
              ) : <p className="muted">Billing isn't configured on this server yet.</p>}
            </div>
          </>
        )}
      </section>

      <GithubSyncCard gh={account.github} refresh={refresh} onBanner={onBanner} onSummon={onSummon} />
      {account.github && <RecapCard login={account.github.login} />}
      {account.github && <AiAttestationCard gh={account.github} act={act} />}
      {account.github && <PetPortalCard
        activePetLookId={account.github.activePetLookId}
        act={act}
        onSetLook={(lookId) => post("/api/account/pet-look", { lookId })}
      />}
      <AchievementsPanel total={account.achievementCount} />
      {account.github?.login && <MeritPanel login={account.github.login} title="Your merit" />}
      {account.github?.quirks && <QuirksPanel quirks={account.github.quirks} title="Your quirks" />}
      <CliSyncCard onBanner={onBanner} />

      <section className="card">
        <h2>Your logins</h2>
        <p className="muted hint">Sign in with any of these — they all reach this one account.</p>
        <ul className="idents">
          {identities.map((id) => (
            <li key={id.id}>
              <span className={`dot ${PROVIDERS[id.provider]?.cls ?? ""}`} />
              <span className="idp">{providerLabel(id.provider)}</span>
              {id.isPrimary && <span className="primary">primary</span>}
              <span className="idsub muted">{id.subject}</span>
              <span className="idActions">
                {!id.isPrimary && <button className="link" onClick={() => act(() => post(`/api/account/identities/${id.id}/primary`))}>Make primary</button>}
                {identities.length > 1 && !id.isPrimary && <button className="link danger" onClick={() => act(() => api(`/api/account/identities/${id.id}`, { method: "DELETE" }))}>Unlink</button>}
              </span>
            </li>
          ))}
        </ul>
        <div className="row">
          {Object.entries(PROVIDERS).filter(([p]) => !identities.some((i) => i.provider === p)).map(([p, v]) => (
            <a className={`btn ${v.cls}`} href={v.href} key={p}>Link {v.label}</a>
          ))}
        </div>
      </section>

      {mergeRequests.length > 0 && (
        <section className="card warn">
          <h2>Pending account merges</h2>
          <p className="muted hint">A login you tried to add already belongs to another account. Accept to fold it into this one.</p>
          <ul className="idents">
            {mergeRequests.map((m) => (
              <li key={m.id}>
                <span className={`dot ${PROVIDERS[m.provider]?.cls ?? ""}`} />
                <span className="idp">{providerLabel(m.provider)}</span>
                <span className="idsub muted">{m.subject}</span>
                <span className="idActions">
                  <button className="link" onClick={() => act(() => post(`/api/account/merge-requests/${m.id}/merge`))}>Accept</button>
                  <button className="link danger" onClick={() => act(() => api(`/api/account/merge-requests/${m.id}`, { method: "DELETE" }))}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Privacy — opt-ins for the ambient social layer (ghost cursors). Stored client-
          side only (localStorage). Default off so nothing about you leaks until you ask
          for it to. */}
      <section className="card">
        <h2>Privacy</h2>
        <CursorLabelToggle />
        <p className="muted hint" style={{ marginTop: 8 }}>Off by default. Tabs that hover the same leaderboard rows you do are shown as anonymous colored dots either way; enabling this just adds your name and avatar pet next to your dot.</p>
      </section>
      {account.github && <PushPrefsCard gh={account.github} act={act} />}
    </>
  );
};

// ── Auth (email + password) ────────────────────────────────────────────────
const AuthView = ({ initial, onAuthed, onBanner }: { initial: "login" | "register" | "forgot"; onAuthed: () => void; onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void }) => {
  const [mode, setMode] = useState<"login" | "register" | "forgot">(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const url = mode === "login" ? "/auth/login" : mode === "register" ? "/auth/register" : "/auth/reset-password/request";
    const body = mode === "forgot" ? { email } : { email, password };
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) {
        if (mode === "login") { onAuthed(); }
        else if (mode === "register") { onBanner({ kind: "info", text: "✉ Account created — check your email for the verification link." }); setMode("login"); }
        else { onBanner({ kind: "info", text: "If the account exists, a reset link has been sent." }); setMode("login"); }
      } else {
        const j = await r.json().catch(() => null) as { error?: string; message?: string } | null;
        setErr(j?.error ?? j?.message ?? `Failed (${r.status}). ${r.status === 403 ? "Verify your email first." : ""}`);
      }
    } catch {
      setErr("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ maxWidth: 460, margin: "20px auto" }}>
      <div className="tabRow">
        <button className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(null); }}>Log in</button>
        <button className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setErr(null); }}>Sign up</button>
        <button className={mode === "forgot" ? "on" : ""} onClick={() => { setMode("forgot"); setErr(null); }}>Forgot</button>
      </div>
      <form className="form" onSubmit={submit}>
        <div className="field"><label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
        {mode !== "forgot" && (
          <div className="field"><label>Password</label><input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></div>
        )}
        {err && <div className="field"><span className="err">{err}</span></div>}
        <button className="btn solid" type="submit" disabled={busy}>{busy ? "…" : mode === "login" ? "Log in" : mode === "register" ? "Create account" : "Send reset link"}</button>
      </form>
      <div className="muted" style={{ textAlign: "center", margin: "12px 0 8px" }}>or</div>
      <div className="cta">
        <a className="btn gh" href={PROVIDERS.github.href}>GitHub</a>
        <a className="btn gg" href={PROVIDERS.google.href}>Google</a>
      </div>
    </section>
  );
};

// ── Reset password (after clicking the reset link) ────────────────────────
const ResetView = ({ token, onDone }: { token: string; onDone: (ok: boolean, msg: string) => void }) => {
  const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await fetch("/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: pw }) });
      if (r.ok) onDone(true, "Password updated — please log in.");
      else { const j = await r.json().catch(() => null) as { error?: string } | null; setErr(j?.error ?? `Failed (${r.status})`); }
    } catch {
      setErr("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" style={{ maxWidth: 460, margin: "20px auto" }}>
      <h2>Set a new password</h2>
      <form className="form" onSubmit={submit}>
        <div className="field"><label>New password</label><input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        {err && <div className="field"><span className="err">{err}</span></div>}
        <button className="btn solid" type="submit" disabled={busy}>{busy ? "…" : "Update password"}</button>
      </form>
    </section>
  );
};

type HomeView = "landing" | "board" | "pricing" | "catalog" | "account" | "auth" | "reset";
const App = ({ initialView = "landing" }: { initialView?: "landing" | "board" }) => {
  const [view, setView] = useState<HomeView>(initialView);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>("score");
  // Audience filter for the leaderboard view. Server filters players.is_ai accordingly so
  // top-N is stable per audience. AI accounts score identically — this is a viewing
  // preference, not a scoring change.
  const [audience, setAudience] = useState<"all" | "humans" | "ai">("all");
  const [boardWindow, setBoardWindow] = useState<"all" | "week" | "season">("all");
  const [profileLogin, setProfileLogin] = useState<string | null>(null);
  const openProfile = useCallback((login: string) => setProfileLogin(login), []);
  // Summon payload for the post-/api/verify cinematic. Keep per-pet look assignments
  // with each seed so newly-earned pets preserve the look they were minted with.
  const [summonPets, setSummonPets] = useState<SummonPet[] | null>(null);
  const [top, setTop] = useState<Entry[]>([]);
  // Newcomers: IDs that appeared in the most recent /api/top result but weren't in the
  // previous one. Their leaderboard row gets a spring zoom + one-shot burst so the entry
  // is visibly an arrival, not a silent reshuffle. Cleared 2.5s after each refetch.
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const prevTopIdsRef = useRef<Set<string> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SkillSheet | null>(null);
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [user, setUser] = useState<{ email?: string; first_name?: string } | null>(null);
  const [cfg, setCfg] = useState<StripeConfig | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "info" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    document.documentElement.dataset.theme = saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }, []);

  const loadAccount = useCallback(async () => {
    const s = await api("/oauth2/status");
    const sessionUser = s.ok ? ((s.data as { user?: { email?: string; first_name?: string } }).user ?? null) : null;
    setUser(sessionUser);
    if (!sessionUser) { setAccount(null); return; }
    const r = await api("/api/account/");
    setAccount(r.ok ? (r.data as Account) : null);
  }, []);

  // leaderboard — live via useLiveQuery on the 'top' topic. Board / audience changes
  // re-key the query (new fetcher). Side-effects (freshIds diff + bell + pad voices)
  // run in a separate effect that watches `data` change with a prev-ids ref, so the
  // data flow stays declarative even though the post-fetch behavior is rich.
  const { data: topData } = useLiveQuery<Entry[]>(
    ["top"],
    (signal) => fetch(`/api/top?n=10&board=${board}&audience=${audience}&window=${boardWindow}`, { signal }).then((r) => r.json()),
    [board, audience, boardWindow],
  );
  useEffect(() => {
    if (!topData) return;
    const ids = new Set(topData.map((e) => e.id).filter((id): id is string => !!id));
    const prev = prevTopIdsRef.current;
    if (prev) {
      const fresh = new Set<string>();
      for (const id of ids) if (!prev.has(id)) fresh.add(id);
      if (fresh.size > 0) {
        setFreshIds(fresh);
        window.setTimeout(() => setFreshIds(new Set()), 2500);
        playBell();   // no-op when sound is off
        // One pad voice per newcomer — adds a single consonant sine to the ambient
        // bed that hangs around for ~60s. Many newcomers in a short span = thicker
        // bed (acoustic activity-density indicator), settling back over the next minute.
        for (let i = 0; i < fresh.size; i++) addPadVoice();
      }
    }
    prevTopIdsRef.current = ids;
    setTop(topData);
    setSel((cur) => cur ?? topData[0]?.id ?? null);
  }, [topData]);
  // Board / audience switch is a new query, not a leaderboard delta — clear the prev
  // set so the next result isn't diffed against an apples-to-oranges baseline. Runs
  // before the topData effect above on a board change.
  useEffect(() => { prevTopIdsRef.current = null; }, [board, audience]);

  // selected player's full skill sheet — live on that player's topic (and any "top"
  // change). Uses the same useLiveQuery helper as RecapCard / WeeklyGrowthStat so the
  // data-loading story is unified across single-fetch-per-event subscribers. The
  // leaderboard keeps its explicit callback because it also diffs freshIds and plays sound.
  const { data: skillsData } = useLiveQuery<SkillSheet | null>(
    sel ? [`player:${sel}`, "top"] : [],
    (signal) => sel ? fetch(`/api/skills?id=${encodeURIComponent(sel)}`, { signal }).then((r) => r.json()) : Promise.resolve(null),
    [sel],
  );
  // sheet state stays in sync with the live query result — keeps the existing setSheet
  // call sites working while the data flow upgrades underneath.
  useEffect(() => { setSheet(skillsData ?? null); }, [skillsData]);

  // account + pricing config, and any redirect-back banner from Stripe / linking
  useEffect(() => {
    loadAccount();
    api("/stripe/config").then((r) => r.ok && setCfg(r.data as StripeConfig));
    const q = new URLSearchParams(window.location.search);
    const billing = q.get("billing"), linked = q.get("linked"), merge = q.get("merge");
    // Secrets use the URL fragment so browsers never send them in requests, access logs,
    // Referer headers, or intermediary caches. Query parsing remains for already-issued links.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const verify = fragment.get("verify") ?? q.get("verify"), reset = fragment.get("reset") ?? q.get("reset");
    if (q.get("view") === "account") setView("account");
    // ?attest-webauthn=<provider>[&evidence=<url>] — the CLI's `renown ai-attest
    // --webauthn` lands users here. Jump to Account, store the prefill so
    // AiAttestationCard picks it up, and clean the URL.
    const attestProvider = q.get("attest-webauthn");
    if (attestProvider) {
      const evidence = q.get("evidence");
      try { window.sessionStorage.setItem("renown:attestWebauthn", JSON.stringify({ provider: attestProvider, evidenceUrl: evidence ?? undefined })); } catch { /* sessionStorage blocked */ }
      setView("account");
      setBanner({ kind: "info", text: `Filled in the attestation form for "${attestProvider}". Scroll to AI attestation and click "Attest with my key" to sign.` });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (billing === "success") setBanner({ kind: "ok", text: "🎉 Subscription active — thank you for supporting renown!" });
    else if (billing === "cancel") setBanner({ kind: "info", text: "Checkout canceled — no charge made." });
    else if (billing === "portal") setBanner({ kind: "info", text: "Billing updated." });
    else if (linked && linked !== "already") setBanner({ kind: "ok", text: `Linked your ${providerLabel(linked)} login.` });
    else if (linked === "already") setBanner({ kind: "info", text: "That login is already on your account." });
    else if (merge === "pending") setBanner({ kind: "warn", text: "That login belongs to another account — see Account to merge." });
    if (billing || linked || merge) { setView("account"); window.history.replaceState({}, "", window.location.pathname); }
    if (verify) {
      fetch("/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: verify }) })
        .then((r) => { if (r.ok) { setBanner({ kind: "ok", text: "Email verified — you can log in now." }); setAuthMode("login"); setView("auth"); } else setBanner({ kind: "warn", text: "Verify link is invalid or expired." }); });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (reset) { setResetToken(reset); setView("reset"); window.history.replaceState({}, "", window.location.pathname); }
  }, [loadAccount]);

  const act = useCallback((fn: () => Promise<{ ok: boolean; data: unknown }>) => {
    (async () => { const r = await fn(); if (r.ok && r.data && typeof r.data === "object" && "identities" in (r.data as object)) setAccount(r.data as Account); else loadAccount(); })();
  }, [loadAccount]);

  // Ambient pad lives only on the account view (where the menagerie is). Started on entry,
  // released on exit. startAmbientPad is a no-op when sound is off, so this is safe to
  // call unconditionally — the user-gesture unlock happens via SoundToggle, not here.
  useEffect(() => {
    if (view === "account") startAmbientPad();
    return () => stopAmbientPad();
  }, [view]);

  const subscribe = useCallback(async (tier: Tier) => {
    setBusy(tier);
    const r = await post("/billing/checkout", { tier });
    if (r.ok && (r.data as { url?: string })?.url) window.location.href = (r.data as { url: string }).url;
    else { setBusy(null); setBanner({ kind: "warn", text: r.status === 401 ? "Please log in first." : "Couldn't start checkout." }); }
  }, []);
  const manage = useCallback(async () => {
    setBusy("portal");
    const r = await post("/billing/portal");
    if (r.ok && (r.data as { url?: string })?.url) window.location.href = (r.data as { url: string }).url;
    else { setBusy(null); setBanner({ kind: "warn", text: "Couldn't open the billing portal." }); }
  }, []);

  const signOut = useCallback(async () => {
    await api("/oauth2/signout", { method: "DELETE" });
    await loadAccount();
    setView("landing");
    setBanner({ kind: "info", text: "You’re logged out." });
  }, [loadAccount]);

  const signedIn = !!account;
  return (
    <main className="wrap">
      <VerifiedAttestationAnnouncer openProfile={openProfile} enabled={account?.github?.pushPrefs?.verifiedAttestation !== false} />
      <RateLimitedAudioAnnouncer />
      <SiteHeader current={(view === "landing" ? "home" : view === "board" ? "leaderboard" : undefined) as SiteSection | undefined} trailing={
        <>
          {account === undefined ? null : signedIn ? (
            <AccountMenu account={account!} user={user} onAccount={() => setView("account")} onSignOut={() => { void signOut(); }} />
          ) : (
            <button className="btn solid sm" onClick={() => { setAuthMode("login"); setView("auth"); }}>Log in</button>
          )}
        </>
      } />

      {banner && <div className={`banner ${banner.kind}`}><span>{banner.text}</span><button onClick={() => setBanner(null)}>✕</button></div>}

      {view === "landing" && <LandingPage signedIn={signedIn} onGetStarted={() => { setAuthMode("register"); setView("auth"); }} />}
      {view === "board" && (
        <>
          <Board top={top} board={board} setBoard={setBoard} audience={audience} setAudience={setAudience} boardWindow={boardWindow} setBoardWindow={setBoardWindow} sel={sel} setSel={(id) => setSel(id)} sheet={sheet} openProfile={openProfile} freshIds={freshIds} myLogin={account?.github?.login ?? null} />
          <TopThisWeek openProfile={openProfile} />
          <TrendingRepos />
        </>
      )}
      {view === "pricing" && <Pricing cfg={cfg} account={account ?? null} onSubscribe={subscribe} busy={busy} onLogIn={() => { setAuthMode("login"); setView("auth"); }} />}
      {view === "catalog" && <>
        <AttestationFeed openProfile={openProfile} />
        <CatalogView signedIn={signedIn} />
      </>}
      {view === "account" && (signedIn
        ? <AccountView account={account!} cfg={cfg} user={user} refresh={loadAccount} onManage={manage} onSubscribe={subscribe} busy={busy} act={act} onBanner={setBanner} onSummon={(pets) => setSummonPets(pets)} />
        : <section className="card"><h2>Account</h2><p className="muted">Log in to manage your account and subscription.</p><div className="cta"><button className="btn solid" onClick={() => { setAuthMode("login"); setView("auth"); }}>Log in</button><button className="btn ghost" onClick={() => { setAuthMode("register"); setView("auth"); }}>Sign up</button></div></section>)}
      {view === "auth" && <AuthView initial={authMode} onAuthed={() => { loadAccount(); setView("account"); setBanner({ kind: "ok", text: "Welcome back." }); }} onBanner={setBanner} />}
      {view === "reset" && resetToken && <ResetView token={resetToken} onDone={(ok, msg) => { setBanner({ kind: ok ? "ok" : "warn", text: msg }); setView("auth"); setResetToken(null); }} />}
      {profileLogin && <ProfileModal login={profileLogin} onClose={() => setProfileLogin(null)}
        me={account?.github?.login ?? null}
        following={account?.following ?? []}
        onToggleFollow={async (l, follow) => { await post(`/api/account/${follow ? "follow" : "unfollow"}`, { login: l }); loadAccount(); }} />}
      {summonPets && summonPets.length > 0 && <SummonCinematic summons={summonPets} onClose={() => setSummonPets(null)} />}
      {/* One shared WebGL context for all <View>-based pets on the page: the Board view (one
          mini-pet per row), the Account view (menagerie grid), or the ProfileModal (showcase
          row's non-hero SinglePets). Pricing / auth / reset stay text-only and skip WebGL
          entirely. drei View auto-pauses individual scrolled-out cards via scissor, so the
          per-frame cost is bounded to what's actually visible. */}
      {(view === "board" || view === "account" || profileLogin !== null) && <MenagerieCanvas />}

      <footer className="foot">by AbsoluteJS · <a href="https://github.com/absolutejs/renown">github.com/absolutejs/renown</a></footer>
    </main>
  );
};

type RenownHomeProps = { cssPath?: string; url?: string; initialView?: "landing" | "board" };
export const RenownHome = ({ cssPath, initialView = "landing" }: RenownHomeProps) => (
  <html lang="en">
    <Head
      cssPath={cssPath}
      title={initialView === "board" ? "Leaderboard — Renown" : "Renown — turn real dev work into a game"}
      description={initialView === "board"
        ? "Rank developers and coding agents by verified score, merit, skills, achievements, and unique pets."
        : "Turn real development work into skills, achievements, quests, rankings, and unique pets generated from your commits."}
    />
    <body>
      <App initialView={initialView} />
    </body>
  </html>
);
