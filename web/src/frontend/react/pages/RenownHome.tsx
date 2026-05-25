import { Head } from "@absolutejs/absolute/react/components";
import { useEffect, useState } from "react";

type Entry = { id?: string; name: string; level: number; xp: number; streak: number; ach: number };

const App = () => {
  const [top, setTop] = useState<Entry[]>([]);
  useEffect(() => {
    fetch("/api/top?n=10").then((r) => r.json()).then(setTop).catch(() => {});
  }, []);
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
              <li key={e.id ?? i}>
                <span className="rank">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                <span className="who">{e.name}</span>
                <span className="lvl">Lv{e.level}</span>
                <span className="xp">{e.xp.toLocaleString()} XP</span>
                <span className="muted">🔥{e.streak} · {e.ach}🏆</span>
              </li>
            ))}
          </ol>
        )}
      </section>
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
