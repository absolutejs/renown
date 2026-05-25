import { Head } from "@absolutejs/absolute/react/components";
import { useEffect, useState } from "react";

type Entry = { id?: string; name: string; level: number; totalLevel?: number; xp: number; streak: number; ach: number };
type Skill = { id: string; name: string; icon: string; level: number; pct: number; xp: number };
type SkillSheet = { id: string; name: string | null; totalLevel: number; skills: Skill[] };

const App = () => {
  const [top, setTop] = useState<Entry[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SkillSheet | null>(null);

  // leaderboard — hydrate once, then refetch when the hub says "top" changed (no polling)
  useEffect(() => {
    const load = () =>
      fetch("/api/top?n=10").then((r) => r.json()).then((d: Entry[]) => {
        setTop(d);
        setSel((cur) => cur ?? d[0]?.id ?? null);
      }).catch(() => {});
    load();
    const es = new EventSource("/sync?topics=top");
    es.onmessage = load;
    return () => es.close();
  }, []);

  // selected player's full skill sheet — live on that player's topic (and any "top" change)
  useEffect(() => {
    if (!sel) return undefined;
    const load = () => fetch(`/api/skills?id=${encodeURIComponent(sel)}`).then((r) => r.json()).then(setSheet).catch(() => {});
    load();
    const es = new EventSource(`/sync?topics=player:${encodeURIComponent(sel)},top`);
    es.onmessage = load;
    return () => es.close();
  }, [sel]);

  const skills = (sheet?.skills ?? []).slice().sort((a, b) => b.level - a.level || b.xp - a.xp);

  return (
    <main className="wrap">
      <header className="hero">
        <h1>⚔ Renown</h1>
        <p className="tag">Earn XP and renown for real, meritorious dev work — in any editor.</p>
        <div className="cta">
          <a className="btn gh" href="/login/github">Log in with GitHub</a>
          <a className="btn gg" href="/login/google">Log in with Google</a>
        </div>
      </header>

      <section className="board">
        <h2>Global leaderboard</h2>
        {top.length === 0 ? (
          <p className="muted">No players yet — be the first.</p>
        ) : (
          <ol className="ranks">
            {top.map((e, i) => (
              <li key={e.id ?? i} className={e.id === sel ? "sel" : ""} onClick={() => e.id && setSel(e.id)}>
                <span className="rank">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                <span className="who">{e.name}</span>
                <span className="lvl">Lvl {e.totalLevel ?? e.level}</span>
                <span className="xp">{e.xp.toLocaleString()} XP</span>
                <span className="muted">🔥{e.streak} · {e.ach}🏆</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {sheet && (
        <section className="skills">
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

      <footer className="foot">by AbsoluteJS · <a href="https://github.com/absolutejs/renown">github.com/absolutejs/renown</a></footer>
    </main>
  );
};

type RenownHomeProps = { cssPath?: string; url?: string };
export const RenownHome = ({ cssPath }: RenownHomeProps) => (
  <html lang="en">
    <Head cssPath={cssPath} title="Renown — earn XP for real dev work" />
    <body>
      <App />
    </body>
  </html>
);
