import { useState } from "react";
import type { PetLookId } from "../../../shared/petLooks.ts";

export type VisitRecap = {
  since: string;
  firstVisit: boolean;
  gained: { xp: number; totalLevel: number; verifiedScore: number; meritScore: number } | null;
  pets: { seed: string; name: string; tier: string; githubLogin: string; serialNumber: number | null; printRun: number | null; lookId: PetLookId }[];
  petTotal: number;
  achievements: { id: string; name: string; description: string; tier: string }[];
  achievementTotal: number;
};

type RevealPet = { seed: string; lookId: PetLookId; serialNumber?: number; printRun?: number };

const ago = (iso: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// The welcome-back summary. Pets stay hidden until the player chooses to reveal them, which
// plays the same summon cinematic a fresh sync does.
export const SinceLastVisit = ({ recap, syncing, onReveal, onClose }: {
  recap: VisitRecap; syncing: string[]; onReveal: (pets: RevealPet[]) => void; onClose: () => void;
}) => {
  const [revealed, setRevealed] = useState(false);
  const gains = recap.gained ? [
    { label: "XP", value: recap.gained.xp },
    { label: recap.gained.totalLevel === 1 ? "level" : "levels", value: recap.gained.totalLevel },
    { label: "verified score", value: recap.gained.verifiedScore },
    { label: "merit", value: recap.gained.meritScore },
  ].filter((gain) => gain.value > 0) : [];
  const reveal = () => {
    setRevealed(true);
    onReveal(recap.pets.map((pet) => ({ seed: pet.seed, lookId: pet.lookId, serialNumber: pet.serialNumber ?? undefined, printRun: pet.printRun ?? undefined })));
  };
  return (
    <div className="modalScrim" role="dialog" aria-modal="true" aria-labelledby="since-visit-title" onClick={onClose}>
      <section className="modal sinceVisit" onClick={(event) => event.stopPropagation()}>
        <button className="modalClose" aria-label="Close" onClick={onClose}>✕</button>
        <span className="collectionEyebrow">{recap.firstVisit ? "THIS PAST WEEK" : `SINCE YOUR LAST VISIT · ${ago(recap.since).toUpperCase()}`}</span>
        <h2 id="since-visit-title">Welcome back</h2>
        {gains.length > 0 && (
          <div className="sinceVisitGains">
            {gains.map((gain) => (
              <div key={gain.label} className="stat"><span className="num">+{gain.value.toLocaleString()}</span><span className="lbl">{gain.label}</span></div>
            ))}
          </div>
        )}
        {recap.petTotal > 0 && (
          <div className="sinceVisitBlock">
            <h3>{recap.petTotal === 1 ? "A new pet found you" : `${recap.petTotal.toLocaleString()} new pets found you`}</h3>
            {revealed ? (
              <ul className="sinceVisitPets">
                {recap.pets.map((pet) => (
                  <li key={pet.seed}>
                    <span className={`petTierDot tier-${pet.tier.toLowerCase()}`} />
                    <strong>{pet.name || "Unnamed"}</strong>
                    <span className="muted"> · {pet.tier}{pet.serialNumber != null && pet.printRun != null ? ` · #${pet.serialNumber} / ${pet.printRun}` : ""} · from @{pet.githubLogin}</span>
                  </li>
                ))}
                {recap.petTotal > recap.pets.length && <li className="muted">…and {(recap.petTotal - recap.pets.length).toLocaleString()} more in your collection</li>}
              </ul>
            ) : (
              <button className="btn solid" onClick={reveal}>Reveal {recap.pets.length === 1 ? "your pet" : `${recap.pets.length} pets`}</button>
            )}
          </div>
        )}
        {recap.achievementTotal > 0 && (
          <div className="sinceVisitBlock">
            <h3>{recap.achievementTotal === 1 ? "1 achievement unlocked" : `${recap.achievementTotal.toLocaleString()} achievements unlocked`}</h3>
            <div className="sinceVisitAchievements">
              {recap.achievements.map((achievement) => (
                <div key={achievement.id} className={`achChip tier-${achievement.tier}`} title={achievement.description}>
                  <span className="achName">{achievement.name}</span><span className="achTier">{achievement.tier}</span>
                </div>
              ))}
              {recap.achievementTotal > recap.achievements.length && <span className="muted">+{(recap.achievementTotal - recap.achievements.length).toLocaleString()} more</span>}
            </div>
          </div>
        )}
        {syncing.length > 0 && <p className="muted hint">Checking GitHub for {syncing.map((login) => `@${login}`).join(", ")}. Anything new will appear here.</p>}
        <div className="cta"><button className="btn ghost" onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
};
