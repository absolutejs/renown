// Public /quests/:login page — this week's directed goals, their progress, and the quest pets
// earned for completing them. Completion settles server-side on load (idempotent). Lightweight.
import { Head } from "@absolutejs/absolute/react/components";
import { SiteHeader } from "../components/SiteHeader";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

type QuestView = { id: string; name: string; desc: string; icon: string; progress: number; target: number; pct: number; completed: boolean; rewardSeed: string | null };
type Quests = { login: string; handle: string; weekKey: string; quests: QuestView[]; completedCount: number };

const RewardPet = ({ seed }: { seed: string }) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box: 56 });
  return <span style={{ width: 56, height: 56, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>` }} />;
};

const Body = ({ q }: { q: Quests }) => (
  <main className="wrap profilePage">
    <SiteHeader back={{ href: `/profile/${encodeURIComponent(q.login)}`, label: "Back to profile" }} />

    <section className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <p className="muted" style={{ textTransform: "uppercase", letterSpacing: 1, fontSize: 13, fontWeight: 700, margin: 0 }}>Weekly quests · {q.weekKey}</p>
        <h1 style={{ margin: "2px 0 0" }}>@{q.login}'s quests</h1>
        <p className="muted" style={{ marginTop: 4 }}>Directed goals that refresh every week. Complete one to hatch a one-off <strong>quest pet</strong> — earned, never bought.</p>
      </div>
      <div style={{ textAlign: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: "#86efac" }}>{q.completedCount}<span className="muted" style={{ fontSize: 20 }}>/{q.quests.length}</span></div>
        <div className="muted" style={{ fontSize: 13 }}>complete</div>
      </div>
    </section>

    <section className="card">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {q.quests.map((quest) => (
          <div key={quest.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 10, background: quest.completed ? "rgba(134,239,172,.08)" : "rgba(255,255,255,.03)", border: `1px solid ${quest.completed ? "rgba(134,239,172,.35)" : "rgba(255,255,255,.07)"}` }}>
            <span style={{ fontSize: 26, flexShrink: 0 }}>{quest.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{quest.name}{quest.completed && <span style={{ color: "#86efac", fontWeight: 800 }}> ✓</span>}</div>
              <div className="muted" style={{ fontSize: 13 }}>{quest.desc}</div>
              <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: "rgba(255,255,255,.07)", overflow: "hidden" }}>
                <div style={{ width: `${quest.pct}%`, height: "100%", background: quest.completed ? "#86efac" : "var(--accent, #8b5cf6)", transition: "width .3s" }} />
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{Math.min(quest.progress, quest.target).toLocaleString()} / {quest.target.toLocaleString()}</div>
            </div>
            {quest.rewardSeed
              ? <a href={`/pet/${encodeURIComponent(quest.rewardSeed)}`} title="Your quest pet" style={{ textDecoration: "none" }}><RewardPet seed={quest.rewardSeed} /></a>
              : <span className="muted" style={{ fontSize: 11, width: 56, textAlign: "center", flexShrink: 0 }}>pet locked</span>}
          </div>
        ))}
      </div>
    </section>
  </main>
);

const NotFound = ({ login }: { login: string }) => (
  <main className="wrap profilePage">
    <SiteHeader back={{ href: "/leaderboard", label: "Back to leaderboard" }} />
    <section className="card"><h1>@{login} isn't on renown yet</h1><p className="muted">No such player.</p></section>
  </main>
);

type RenownQuestsProps = { cssPath?: string; quests?: Quests | null; login?: string; origin?: string };

export const RenownQuests = ({ cssPath, quests = null, login = "", origin = "" }: RenownQuestsProps) => {
  const who = quests?.login ?? login;
  const title = `@${who}'s weekly quests — Renown`;
  const desc = quests ? `${quests.completedCount}/${quests.quests.length} weekly quests complete. Directed goals that hatch quest pets.` : `${who} on Renown.`;
  const url = `${origin}/quests/${who}`;
  return (
    <html lang="en">
      <Head cssPath={cssPath} title={title} description={desc} canonical={url}
        openGraph={{ title, description: desc, type: "website", url, siteName: "Renown" }}
        twitter={{ card: "summary", title, description: desc }} />
      <body>{quests ? <Body q={quests} /> : <NotFound login={who} />}</body>
    </html>
  );
};
