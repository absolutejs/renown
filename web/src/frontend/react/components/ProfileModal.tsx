// Public profile shown when you click a leaderboard entry. Renders the player's avatar pet
// (big), their tier-gated showcase (small row), and their leaderboard stats. All public data —
// no PII; just what the leaderboard already exposes plus the curated 3D showcase.
import { useEffect, useState } from "react";
import { SinglePet } from "./PetViewer";
import { isPetLookId, resolvePetLookId, type PetLookId } from "../../../../../core/petLooks.ts";

type Tier = "free" | "supporter" | "pro";
type AchievementRow = { id: string; name: string; description: string; tier: string; category: string; unlockCount: number };
type AttestationEvent = { id: string; at: string; kind: string; provider: string | null; evidenceUrl: string | null; verified: boolean; actorKind?: string | null };
type MeritBlock = {
  score: number; reviews: number; crossRepo: number; authored: number; merged: number;
  mergeRatio: number; downloads: number; substanceScore: number; substanceSampleSize: number;
  lastSyncAt: string | null;
};
const resolveProfilePetLook = (seed: string, activePetLookId: string | undefined, petLookAssignments: Record<string, PetLookId>): PetLookId => {
  const override = petLookAssignments[seed];
  return isPetLookId(override) ? override : resolvePetLookId(activePetLookId);
};
type Profile = {
  login: string; handle: string; tier: Tier; isAi?: boolean;
  aiAttestation?: { provider: string; claimedAt: string; evidenceUrl?: string; verified?: boolean; webauthnVerified?: boolean } | null;
  score: number; baseScore?: number; meritScore?: number; totalLevel: number;
  petsCount: number; rarestPetScore: number; biggestPetSize: number;
  avatarSeed: string | null; showcaseSeeds: string[];
  achievements?: AchievementRow[];
  attestationEvents?: AttestationEvent[];
  rateLimitCount?: number;
  quirks?: Record<string, number>;
  activePetLookId?: string;
  petLookAssignments?: Record<string, PetLookId>;
  merit?: MeritBlock;
};

// Mirrors AchievementsPanel from RenownHome — same data, sized for the modal context.
// Kept inline so ProfileModal doesn't have to import from a page module (one-way deps).
const TIER_ORDER: Record<string, number> = { mythic: 0, platinum: 1, gold: 2, silver: 3, bronze: 4, secret: 5 };
const QUIRK_TIER: Record<number, [string, string]> = { 1: ["🥉", "bronze"], 10: ["🥈", "silver"], 100: ["🥇", "gold"], 1000: ["🏆", "mythic"] };
const quirkTierFor = (n: number): [string, string] => n >= 1000 ? QUIRK_TIER[1000]! : n >= 100 ? QUIRK_TIER[100]! : n >= 10 ? QUIRK_TIER[10]! : QUIRK_TIER[1]!;

// Share affordances — pulled out so the modal head can stay legible and the
// "open in new tab" link reuses the same URL the OG/canonical tag references.
// The URL is constructed client-side (window.location.origin) so it works on
// any host the modal is rendered on (preview deploys, localhost, prod).
const ProfileShareRow = ({ login }: { login: string }) => {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? `/profile/${login}` : `${window.location.origin}/profile/${login}`;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — user can still click "Open public page" */ }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 12 }}>
      <button
        onClick={onCopy}
        style={{ padding: "5px 10px", background: copied ? "rgba(134,239,172,.18)" : "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 5, color: "inherit", cursor: "pointer", fontSize: 12 }}
        title="Copy a sharable link to this profile"
      >
        {copied ? "✓ Copied" : "🔗 Copy link"}
      </button>
      <a
        href={`/profile/${login}`}
        target="_blank"
        rel="noreferrer"
        style={{ padding: "5px 10px", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 5, textDecoration: "none", color: "inherit", fontSize: 12 }}
        title="Open the public profile page in a new tab"
      >
        Open public page ↗
      </a>
    </div>
  );
};

export const ProfileModal = ({ login, onClose, me = null, following = [], onToggleFollow }: { login: string; onClose: () => void; me?: string | null; following?: string[]; onToggleFollow?: (login: string, follow: boolean) => void | Promise<void> }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Follow state (optimistic). Visible only when signed in and viewing someone else.
  const canFollow = !!me && me.toLowerCase() !== login.toLowerCase();
  const [isFollowing, setIsFollowing] = useState(false);
  useEffect(() => { setIsFollowing(following.some((l) => l.toLowerCase() === login.toLowerCase())); }, [following, login]);
  const toggleFollow = async () => { const next = !isFollowing; setIsFollowing(next); try { await onToggleFollow?.(login, next); } catch { setIsFollowing(!next); } };
  useEffect(() => {
    fetch(`/api/profile/${encodeURIComponent(login)}`).then(async (r) => {
      if (!r.ok) { setErr("Profile not found."); return; }
      const j = await r.json();
      if ("error" in j) setErr(j.error);
      else setProfile(j);
    });
  }, [login]);
  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modalScrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        {err && <p className="muted">{err}</p>}
        {!err && !profile && <p className="muted">Loading…</p>}
        {profile && (
          <>
            <div className="profileHead">
              <div>
                <h2>
                  @{profile.login}
                  {profile.isAi && (
                    <span className={`aiBadge${profile.aiAttestation ? " attested" : ""}`} style={{ marginLeft: 10 }} title={profile.aiAttestation ? `AI participant · attested as ${profile.aiAttestation.provider}` : "AI participant"}>
                      🤖 {profile.aiAttestation ? profile.aiAttestation.provider : "AI"}
                    </span>
                  )}
                </h2>
                <p className="muted">
                  {profile.handle}
                  {profile.tier !== "free" && <span className={`tierChip ${profile.tier}`} style={{ marginLeft: 10 }}>{profile.tier}</span>}
                  {profile.aiAttestation?.evidenceUrl && (
                    <> · <a href={profile.aiAttestation.evidenceUrl} target="_blank" rel="noreferrer">attestation evidence ↗</a></>
                  )}
                </p>
              </div>
              <div className="profileScore">
                <span className="num">{profile.score.toLocaleString()}</span>
                <span className="lbl">score</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "4px 0 2px" }}>
              {canFollow && (
                <button onClick={toggleFollow} style={{ padding: "6px 14px", borderRadius: 999, cursor: "pointer", fontWeight: 700, fontSize: 13,
                  background: isFollowing ? "rgba(134,239,172,.16)" : "var(--accent, #8b5cf6)", color: isFollowing ? "#86efac" : "#fff",
                  border: `1px solid ${isFollowing ? "rgba(134,239,172,.5)" : "transparent"}` }}>
                  {isFollowing ? "✓ Following" : "+ Follow"}
                </button>
              )}
              <a href={`/rivals/${encodeURIComponent(profile.login)}`} className="muted" style={{ fontSize: 13, textDecoration: "none" }}>rivals →</a>
            </div>
            <ProfileShareRow login={profile.login} />
            <div className="profileAvatar">
              {profile.avatarSeed
                ? <SinglePet seed={profile.avatarSeed} hero lookId={resolveProfilePetLook(profile.avatarSeed, profile.activePetLookId, profile.petLookAssignments ?? {})} />
                : <div className="petCanvas profileAvatarEmpty"><span className="muted">no avatar pet yet</span></div>}
            </div>
            <div className="profileStats">
              <div className="stat"><span className="num">{profile.petsCount.toLocaleString()}</span><span className="lbl">pets owned</span></div>
              <div className="stat"><span className="num">{profile.rarestPetScore.toFixed(2)}</span><span className="lbl">rarest pet</span></div>
              <div className="stat"><span className="num">{profile.biggestPetSize}</span><span className="lbl">biggest size</span></div>
              <div className="stat"><span className="num">{profile.totalLevel.toLocaleString()}</span><span className="lbl">total level</span></div>
            </div>
            {profile.merit && profile.merit.score > 0 && (
              <>
                <h3 className="muted" style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8 }}>
                  Merit · {profile.merit.score.toLocaleString()} pts
                </h3>
                <p className="muted hint" style={{ marginTop: 4 }}>
                  Hard-to-game signals — reviews, cross-repo merges, ratio, downloads, commit substance.
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
              </>
            )}
            {profile.showcaseSeeds.length > 0 && (
              <>
                <h3 className="muted" style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8 }}>Showcase</h3>
                <div className="profileShowcase">
                  {profile.showcaseSeeds.map((seed) => (
                    <div className="petCard" key={seed}><SinglePet seed={seed} lookId={resolveProfilePetLook(seed, profile.activePetLookId, profile.petLookAssignments ?? {})} /></div>
                  ))}
                </div>
              </>
            )}
            {profile.attestationEvents && profile.attestationEvents.length > 0 && (
              <>
                <h3 className="muted" style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8 }}>Attestation trail · {profile.attestationEvents.length}</h3>
                <ul className="attestTrail">
                  {profile.attestationEvents.map((ev) => (
                    <li key={ev.id} className={`attestTrailRow attestKind-${ev.kind}`}>
                      <span className="attestDot" aria-hidden>{ev.kind === "verified" ? "✓" : ev.kind === "cleared" ? "✕" : "●"}</span>
                      <span className="attestKindLabel">{ev.kind}</span>
                      {ev.provider && <span className="muted"> · {ev.provider}</span>}
                      {ev.actorKind && <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>by {ev.actorKind}</span>}
                      {ev.verified && <span className="aiBadge verified" style={{ fontSize: 9, marginLeft: 6, padding: "1px 5px" }}>verified</span>}
                      {ev.evidenceUrl && <a className="muted" href={ev.evidenceUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 6, fontSize: 11 }}>evidence ↗</a>}
                      <span className="muted attestTrailAt">{new Date(ev.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {profile.achievements && profile.achievements.length > 0 && (() => {
              const groups = new Map<string, AchievementRow[]>();
              for (const a of profile.achievements) {
                const arr = groups.get(a.category) ?? [];
                arr.push(a);
                groups.set(a.category, arr);
              }
              for (const arr of groups.values()) arr.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
              return (
                <>
                  <h3 className="muted" style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8 }}>Achievements · {profile.achievements.length} earned</h3>
                  <div className="achGroups">
                    {[...groups.entries()].map(([cat, arr]) => (
                      <div className="achGroup" key={cat}>
                        <h3 className="achGroupName">{cat}</h3>
                        <div className="achList">
                          {arr.map((a) => (
                            <div key={a.id} className={`achChip tier-${a.tier}`} title={`${a.description} · ${a.unlockCount.toLocaleString()} other${a.unlockCount === 1 ? "" : "s"} earned this`}>
                              <span className="achName">{a.name}</span>
                              <span className="achTier">{a.tier}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
            {profile.quirks && Object.values(profile.quirks).some((n) => n > 0) && (() => {
              const entries = Object.entries(profile.quirks!).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a);
              return (
                <>
                  <h3 className="muted" style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8 }}>Quirks · {entries.length}</h3>
                  <p className="muted hint" style={{ marginTop: 4 }}>Self-reported cope ladder — the badge is real, the cope is the achievement.</p>
                  <div className="achList" style={{ marginTop: 8 }}>
                    {entries.map(([id, count]) => {
                      const [emoji, tier] = quirkTierFor(count);
                      return (
                        <div key={id} className={`achChip tier-${tier}`} title={`${id} · ${count.toLocaleString()}`}>
                          <span className="achName">{emoji} {id}</span>
                          <span className="achTier">{count.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
};
