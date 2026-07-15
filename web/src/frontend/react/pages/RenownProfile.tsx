// Standalone /profile/:login page. SSR-rendered with profile-specific <title>
// and OpenGraph/Twitter tags so a shared URL produces a meaningful card on
// Twitter / Slack / Discord / LinkedIn / Bluesky. Visitors arriving via a
// share land here directly (no auth, no setup) and see exactly the player's
// merit, achievements, and 3D pet menagerie.
//
// Layout intentionally separates from RenownHome — the leaderboard's heavy
// chunks (cursor sync, parade physics, audio bed) aren't loaded so the page
// is fast even with the 3D pet viewer. A "Browse leaderboard →" link at top
// invites discovery without bundling everything.

import { Head } from "@absolutejs/absolute/react/components";
import { SiteHeader } from "../components/SiteHeader";
import { useEffect, useState } from "react";
import { SinglePet } from "../components/PetViewer";
import { isPetLookId, resolvePetLookId, type PetLookId } from "../../../shared/petLooks.ts";

type Tier = "free" | "supporter" | "pro";
type Attestation = { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean; webauthnVerified?: boolean; expiresAt?: string };
type AchievementRow = { id: string; name: string; description: string; tier: string; category: string; unlockCount: number };
type Merit = {
  score: number;
  reviews: number;
  crossRepo: number;
  authored: number;
  merged: number;
  mergeRatio: number;
  downloads: number;
  substanceScore: number;
  substanceSampleSize: number;
  lastSyncAt: string | null;
};
type ProfileForUI = {
  login: string;
  handle: string;
  tier: Tier;
  isAi: boolean;
  aiAttestation: Attestation | null;
  score: number;
  meritScore?: number;
  totalLevel: number;
  petsCount: number;
  rarestPetScore: number;
  biggestPetSize: number;
  avatarSeed: string | null;
  showcaseSeeds: string[];
  quirks?: Record<string, number>;
  activePetLookId?: string;
  petLookAssignments?: Record<string, PetLookId>;
  merit?: Merit | null;
  achievements?: AchievementRow[];
  topProjects?: { key: string; stars: number; oss: boolean; xp: number; commits: number; verified: boolean }[];
};

// Mirrors ProfileModal's quirk tier mapping. Inlined to keep this page free
// of cross-page imports (ProfileModal pulls in modal/scrim CSS we don't need).
const QUIRK_TIER: Record<number, [string, string]> = { 1: ["🥉", "bronze"], 10: ["🥈", "silver"], 100: ["🥇", "gold"], 1000: ["🏆", "mythic"] };
const quirkTierFor = (n: number): [string, string] =>
  n >= 1000 ? QUIRK_TIER[1000]! : n >= 100 ? QUIRK_TIER[100]! : n >= 10 ? QUIRK_TIER[10]! : QUIRK_TIER[1]!;
const TIER_ORDER: Record<string, number> = { mythic: 0, platinum: 1, gold: 2, silver: 3, bronze: 4, secret: 5 };

const resolveProfilePetLook = (seed: string, activePetLookId: string | null | undefined, petLookAssignments: Record<string, PetLookId>): PetLookId => {
  const override = petLookAssignments[seed];
  return isPetLookId(override) ? override : resolvePetLookId(activePetLookId);
};

const ShareButton = ({ url }: { url: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — user can still copy the URL bar */ }
  };
  // Pre-fill a Twitter intent with the URL + a short pitch — the recipient
  // sees the OG card from the URL itself, so the pitch stays minimal.
  const twitterHref = `https://twitter.com/intent/tweet?${new URLSearchParams({
    text: "renown — XP and renown for real, meritorious dev work",
    url,
  }).toString()}`;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        onClick={onCopy}
        style={{ padding: "6px 12px", background: copied ? "rgba(134,239,172,.18)" : "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, color: "inherit", cursor: "pointer", fontSize: 13 }}
      >
        {copied ? "✓ Link copied" : "🔗 Copy share link"}
      </button>
      <a
        href={twitterHref}
        target="_blank"
        rel="noreferrer"
        style={{ padding: "6px 12px", background: "rgba(29,155,240,.12)", border: "1px solid rgba(29,155,240,.35)", borderRadius: 6, textDecoration: "none", color: "inherit", fontSize: 13 }}
      >
        Tweet
      </a>
    </div>
  );
};

const ProfileBody = ({ profile, url }: { profile: ProfileForUI; url: string }) => {
  // Group achievements by category — same shape ProfileModal uses, but
  // rendered as a full-page section grid instead of a modal scroll.
  const ach = profile.achievements ?? [];
  const groups = new Map<string, typeof ach>();
  for (const a of ach) {
    const arr = groups.get(a.category) ?? [];
    arr.push(a);
    groups.set(a.category, arr);
  }
  for (const arr of groups.values()) arr.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));

  const quirkEntries = Object.entries(profile.quirks ?? {}).filter(([, n]) => (n as number) > 0).sort(([, a], [, b]) => (b as number) - (a as number));

  return (
    <main className="wrap profilePage">
      <SiteHeader back={{ href: "/leaderboard", label: "Back to leaderboard" }} />

      <section className="card">
        <div className="profileHead">
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>
              @{profile.login}
              {profile.isAi && (
                <span className={`aiBadge${profile.aiAttestation ? " attested" : ""}`} style={{ marginLeft: 12, fontSize: 14 }} title={profile.aiAttestation ? `AI participant · attested as ${profile.aiAttestation.provider}` : "AI participant"}>
                  🤖 {profile.aiAttestation ? profile.aiAttestation.provider : "AI"}
                </span>
              )}
            </h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {profile.handle}
              {profile.tier !== "free" && <span className={`tierChip ${profile.tier}`} style={{ marginLeft: 10 }}>{profile.tier}</span>}
            </p>
          </div>
          <div className="profileScore">
            <span className="num">{profile.score.toLocaleString()}</span>
            <span className="lbl">score</span>
          </div>
        </div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <ShareButton url={url} />
          <a href={url.replace("/profile/", "/recap/")} style={{ fontSize: 13, fontWeight: 700, color: "#c4b5fd", textDecoration: "none" }}>This week →</a>
        </div>
      </section>

      <section className="card">
        <h2>Avatar</h2>
        <div className="profileAvatar">
          {profile.avatarSeed
            ? <SinglePet seed={profile.avatarSeed} hero lookId={resolveProfilePetLook(profile.avatarSeed, profile.activePetLookId, profile.petLookAssignments ?? {})} />
            : <div className="petCanvas profileAvatarEmpty"><span className="muted">no avatar pet yet</span></div>}
        </div>
        {profile.avatarSeed && <p style={{ textAlign: "center", marginTop: 6 }}><a href={`/pet/${encodeURIComponent(profile.avatarSeed)}`} className="muted" style={{ fontSize: 12, textDecoration: "none" }}>View this pet →</a></p>}
        <div className="profileStats">
          <div className="stat"><span className="num">{profile.petsCount.toLocaleString()}</span><span className="lbl">pets owned</span></div>
          <div className="stat"><span className="num">{profile.rarestPetScore.toFixed(2)}</span><span className="lbl">rarest pet</span></div>
          <div className="stat"><span className="num">{profile.biggestPetSize}</span><span className="lbl">biggest size</span></div>
          <div className="stat"><span className="num">{profile.totalLevel.toLocaleString()}</span><span className="lbl">total level</span></div>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Add this badge to your README</summary>
          <p style={{ marginTop: 8 }}><img src={`${url}/badge.svg`} alt="renown badge preview" /></p>
          <code style={{ display: "block", overflowX: "auto", whiteSpace: "nowrap", padding: "10px 12px", background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 8, fontSize: 12 }}>{`[![renown](${url}/badge.svg)](${url})`}</code>
        </details>
      </section>

      {profile.merit && profile.merit.score > 0 && (
        <section className="card">
          <h2>Merit <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {profile.merit.score.toLocaleString()} pts</span></h2>
          <p className="muted hint">
            The hard-to-game half — signals that someone outside @{profile.login}'s control had to validate (a reviewer, a maintainer, an installer).
            {profile.merit.lastSyncAt && <> Last synced {new Date(profile.merit.lastSyncAt).toLocaleDateString()}.</>}
          </p>
          <div className="profileStats" style={{ marginTop: 8 }}>
            <div className="stat"><span className="num">{profile.merit.reviews.toLocaleString()}</span><span className="lbl">PR reviews</span></div>
            <div className="stat"><span className="num">{profile.merit.crossRepo.toLocaleString()}</span><span className="lbl">cross-repo PRs</span></div>
            <div className="stat"><span className="num">{profile.merit.merged.toLocaleString()}</span><span className="lbl">PRs merged{profile.merit.authored > 0 ? ` (${Math.round(profile.merit.mergeRatio * 100)}%)` : ""}</span></div>
            <div className="stat"><span className="num">{profile.merit.downloads >= 1_000_000 ? (profile.merit.downloads / 1_000_000).toFixed(1) + "M" : profile.merit.downloads.toLocaleString()}</span><span className="lbl">npm DLs/mo</span></div>
            {profile.merit.substanceSampleSize >= 10 && (
              <div className="stat"><span className="num">{Math.round(profile.merit.substanceScore * 100)}%</span><span className="lbl">substance</span></div>
            )}
          </div>
        </section>
      )}

      {(profile.topProjects?.length ?? 0) > 0 && (
        <section className="card">
          <h2>Top repos <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· renown by repo</span></h2>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {profile.topProjects!.map((r) => (
              <a key={r.key} href={`/project/${r.key}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}{r.verified && <span title="GitHub-verified via CI" style={{ color: "#86efac", fontSize: 12 }}> ✓</span>}{r.oss && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · OSS</span>}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{r.xp.toLocaleString()} XP</span>
                <span className="muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{r.commits.toLocaleString()} commits</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {profile.showcaseSeeds.length > 0 && (
        <section className="card">
          <h2>Showcase <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {profile.showcaseSeeds.length} {profile.showcaseSeeds.length === 1 ? "pet" : "pets"}</span></h2>
          <div className="profileShowcase">
            {profile.showcaseSeeds.map((seed) => (
              <div className="petCard" key={seed}>
                <SinglePet seed={seed} lookId={resolveProfilePetLook(seed, profile.activePetLookId, profile.petLookAssignments ?? {})} />
                <a href={`/pet/${encodeURIComponent(seed)}`} className="muted" style={{ display: "block", textAlign: "center", fontSize: 12, marginTop: 6, textDecoration: "none" }}>View pet →</a>
              </div>
            ))}
          </div>
        </section>
      )}

      {ach.length > 0 && (
        <section className="card">
          <h2>Achievements <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {ach.length} earned</span></h2>
          <div className="achGroups">
            {[...groups.entries()].map(([cat, arr]) => (
              <div className="achGroup" key={cat}>
                <h3 className="achGroupName">{cat}</h3>
                <div className="achList">
                  {arr.map((a) => (
                    <a key={a.id} href={`/achievement/${encodeURIComponent(a.id)}`} className={`achChip tier-${a.tier}`} style={{ textDecoration: "none", color: "inherit" }} title={`${a.description} · ${a.unlockCount.toLocaleString()} other${a.unlockCount === 1 ? "" : "s"} earned this — open its page`}>
                      <span className="achName">{a.name}</span>
                      <span className="achTier">{a.tier}</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {quirkEntries.length > 0 && (
        <section className="card">
          <h2>Quirks <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {quirkEntries.length}</span></h2>
          <p className="muted hint">Self-reported cope ladder. The badge is real; the cope is the achievement.</p>
          <div className="achList" style={{ marginTop: 8 }}>
            {quirkEntries.map(([id, count]) => {
              const [emoji, tier] = quirkTierFor(count as number);
              return (
                <div key={id} className={`achChip tier-${tier}`} title={`${id} · ${(count as number).toLocaleString()}`}>
                  <span className="achName">{emoji} {id}</span>
                  <span className="achTier">{(count as number).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="muted" style={{ textAlign: "center", marginTop: 24, fontSize: 12 }}>
        by AbsoluteJS · <a href="https://github.com/absolutejs/renown" style={{ color: "inherit" }}>github.com/absolutejs/renown</a>
      </div>
    </main>
  );
};

// Not-found state — direct visits to /profile/nonexistent shouldn't be a
// blank screen. Mirrors the brand-bar so visitors can pivot to the
// leaderboard / sign up.
const ProfileNotFound = ({ login }: { login: string }) => (
  <main className="wrap profilePage">
    <SiteHeader back={{ href: "/leaderboard", label: "Back to leaderboard" }} />
    <section className="card" style={{ textAlign: "center" }}>
      <h1>No renown for @{login}</h1>
      <p className="muted">Either this GitHub login isn't on renown yet, or they haven't verified ownership.</p>
    </section>
  </main>
);

// Client-side wrapper: the SSR pass receives `profile`/`login`/`url` from the
// page handler; client hydration receives the same. Visit-while-page-changes
// is handled by full reload (each profile is its own URL).
const ProfileApp = ({ profile, login, url }: { profile: ProfileForUI | null; login: string; url: string }) => {
  // Client-side: react to URL changes (back/forward) by full-reloading the
  // matching profile. Cheap, matches the SSR model, no SPA router lift.
  useEffect(() => {
    const onPopstate = () => { window.location.reload(); };
    window.addEventListener("popstate", onPopstate);
    return () => window.removeEventListener("popstate", onPopstate);
  }, []);
  if (!profile) return <ProfileNotFound login={login} />;
  return <ProfileBody profile={profile} url={url} />;
};

type RenownProfileProps = {
  cssPath?: string;
  url?: string;
  // SSR-prefetched. Null when login doesn't resolve to a verified player.
  profile?: ProfileForUI | null;
  // Path-extracted login. Used for the not-found state when profile is null.
  login?: string;
  // Absolute origin (https://renown.app) so OG tags reference fully-qualified
  // URLs. Pre-computed server-side from the request headers.
  origin?: string;
  // Short merit snippet (e.g. "300k DLs/mo · 78 cross-repo PRs · 85 reviews")
  // used as the OG description.
  shareSnippet?: string;
};

export const RenownProfile = ({
  cssPath,
  profile = null,
  login = "",
  origin = "",
  shareSnippet = "Earning renown for real, meritorious dev work.",
}: RenownProfileProps) => {
  const fullUrl = `${origin}/profile/${encodeURIComponent(profile?.login ?? login)}`;
  const title = profile
    ? `@${profile.login} on Renown · ${profile.score.toLocaleString()} score${(profile.meritScore ?? 0) > 0 ? ` · ${(profile.meritScore ?? 0).toLocaleString()} merit` : ""}`
    : `@${login} — not on Renown yet`;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={shareSnippet}
        canonical={fullUrl}
        openGraph={{
          title,
          description: shareSnippet,
          type: "profile",
          url: fullUrl,
          // Per-profile OG image route. Generated on-the-fly (or cached) by
          // the same pagesPlugin route that served this page — recipients of
          // a shared URL see a card with the player's name + top stats.
          // The image route is implemented separately (task #151).
          image: profile ? `${origin}/profile/${encodeURIComponent(profile.login)}/og.png` : undefined,
          imageAlt: profile ? `@${profile.login} on Renown` : undefined,
          imageWidth: 1200,
          imageHeight: 630,
          siteName: "Renown",
        }}
        twitter={{
          card: "summary_large_image",
          title,
          description: shareSnippet,
          image: profile ? `${origin}/profile/${encodeURIComponent(profile.login)}/og.png` : undefined,
          imageAlt: profile ? `@${profile.login} on Renown` : undefined,
        }}
      />
      <body>
        <ProfileApp profile={profile} login={profile?.login ?? login} url={fullUrl} />
      </body>
    </html>
  );
};
