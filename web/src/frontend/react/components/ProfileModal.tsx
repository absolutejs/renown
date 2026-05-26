// Public profile shown when you click a leaderboard entry. Renders the player's avatar pet
// (big), their tier-gated showcase (small row), and their leaderboard stats. All public data —
// no PII; just what the leaderboard already exposes plus the curated 3D showcase.
import { useEffect, useState } from "react";
import { SinglePet } from "./PetViewer";

type Tier = "free" | "supporter" | "pro";
type Profile = {
  login: string; handle: string; tier: Tier;
  score: number; totalLevel: number;
  petsCount: number; rarestPetScore: number; biggestPetSize: number;
  avatarSeed: string | null; showcaseSeeds: string[];
};

export const ProfileModal = ({ login, onClose }: { login: string; onClose: () => void }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
                <h2>@{profile.login}</h2>
                <p className="muted">{profile.handle}{profile.tier !== "free" && <span className={`tierChip ${profile.tier}`} style={{ marginLeft: 10 }}>{profile.tier}</span>}</p>
              </div>
              <div className="profileScore">
                <span className="num">{profile.score.toLocaleString()}</span>
                <span className="lbl">score</span>
              </div>
            </div>
            <div className="profileAvatar">
              {profile.avatarSeed
                ? <SinglePet seed={profile.avatarSeed} />
                : <div className="petCanvas profileAvatarEmpty"><span className="muted">no avatar pet yet</span></div>}
            </div>
            <div className="profileStats">
              <div className="stat"><span className="num">{profile.petsCount.toLocaleString()}</span><span className="lbl">pets owned</span></div>
              <div className="stat"><span className="num">{profile.rarestPetScore.toFixed(2)}</span><span className="lbl">rarest pet</span></div>
              <div className="stat"><span className="num">{profile.biggestPetSize}</span><span className="lbl">biggest size</span></div>
              <div className="stat"><span className="num">{profile.totalLevel.toLocaleString()}</span><span className="lbl">total level</span></div>
            </div>
            {profile.showcaseSeeds.length > 0 && (
              <>
                <h3 className="muted" style={{ marginTop: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8 }}>Showcase</h3>
                <div className="profileShowcase">
                  {profile.showcaseSeeds.map((seed) => (
                    <div className="petCard" key={seed}><SinglePet seed={seed} /></div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
