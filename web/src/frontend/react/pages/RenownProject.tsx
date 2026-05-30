// Public /project/:owner/:repo page — a per-repo leaderboard ranking that repo's renown
// contributors by per-project XP, plus a copyable README badge snippet and an install CTA.
// The viral surface: a badge in a repo's README links here, advertising renown to everyone
// who views the repo. SSR with repo-specific OG tags so shared links produce a real card.
//
// Deliberately LIGHTWEIGHT — unlike RenownProfile this imports NO 3D PetViewer/three.js, so the
// page stays fast + crawlable. Contributor pets live on their own /profile pages; the top pet
// renders server-side in the OG card only.
import { Head } from "@absolutejs/absolute/react/components";
import { useState } from "react";
import { generate } from "../../../../../core/procgen.ts";
import { spriteToSvg } from "../../../../../core/petSvg.ts";

// Each contributor's 1/1 pet, rendered as a static 2D SVG (the same canonical sprite the OG
// card + 3D viewer use) — no three.js, so the board stays fast + crawlable but still shows the
// signature renown pets. Returns a wrapped <svg> string for dangerouslySetInnerHTML.
const petSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>`;
};
const PetSprite = ({ seed, box }: { seed: string; box: number }) => (
  <span style={{ width: box, height: box, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: petSvgHtml(seed, box) }} />
);

type Contributor = { login: string; handle: string; avatarSeed: string | null; isAi: boolean; tier: string; xp: number; commits: number; lines: number };
type ProjectForUI = {
  key: string; owner: string; repo: string; name: string; stars: number; oss: boolean;
  sort: "xp" | "commits" | "lines";
  contributors: Contributor[]; topContributor: Contributor | null;
  totals: { devs: number; xp: number; commits: number; lines: number };
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const SORT_LABEL = { xp: "renown XP", commits: "commits", lines: "lines" } as const;

const Copyable = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* user can select it */ }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <code style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap", padding: "10px 12px", background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 8, fontSize: 12.5 }}>{text}</code>
      <button onClick={onCopy} style={{ padding: "6px 12px", background: copied ? "rgba(134,239,172,.18)" : "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, color: "inherit", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}>{copied ? "✓ Copied" : "Copy"}</button>
    </div>
  );
};

const ProjectNotFound = ({ keyParam }: { keyParam: string }) => (
  <main className="wrap profilePage">
    <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a></header>
    <section className="card" style={{ textAlign: "center" }}>
      <h1>{keyParam} isn't on Renown yet</h1>
      <p className="muted">No one tracking this repo with renown has a verified contribution here yet. Be the first.</p>
      <div style={{ maxWidth: 560, margin: "18px auto 0", textAlign: "left" }}>
        <Copyable text="npm install -g @absolutejs/renown" />
        <p className="muted" style={{ marginTop: 8 }}>Then <code>gh auth login</code> and <code>renown link</code> — your commits here start earning renown.</p>
      </div>
      <p style={{ marginTop: 16 }}><a href="/">← Browse the leaderboard</a></p>
    </section>
  </main>
);

const ProjectBody = ({ project, origin }: { project: ProjectForUI; origin: string }) => {
  const pageUrl = `${origin}/project/${project.key}`;
  const badgeMd = `[![renown](${origin}/project/${project.key}/badge.svg)](${pageUrl})`;
  return (
    <main className="wrap profilePage">
      <header className="topbar"><a href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}><span>Renown</span></a>  <a href="/" className="muted" style={{ marginLeft: 12 }}>← Browse leaderboard</a></header>

      <section className="card" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ marginBottom: 4 }}>{project.key}</h1>
          <p className="muted">
            {project.stars > 0 && <>★ {fmt(project.stars)} · </>}
            {project.oss ? "open source · " : ""}
            {fmt(project.totals.devs)} dev{project.totals.devs === 1 ? "" : "s"} earning renown · {fmt(project.totals.xp)} XP · {fmt(project.totals.commits)} commits
          </p>
        </div>
        {project.topContributor?.avatarSeed && (
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <PetSprite seed={project.topContributor.avatarSeed} box={96} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>top · @{project.topContributor.login}</div>
          </div>
        )}
      </section>

      <section className="card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Contributors <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· ranked by {SORT_LABEL[project.sort]} on this repo</span></h2>
          <nav style={{ display: "flex", gap: 4, fontSize: 13 }}>
            {(["xp", "commits", "lines"] as const).map((s) => (
              <a key={s} href={`/project/${project.key}?sort=${s}`} style={{
                padding: "4px 10px", borderRadius: 999, textDecoration: "none",
                background: project.sort === s ? "rgba(134,239,172,.16)" : "rgba(255,255,255,.04)",
                border: `1px solid ${project.sort === s ? "rgba(134,239,172,.4)" : "rgba(255,255,255,.10)"}`,
                color: "inherit", fontWeight: project.sort === s ? 700 : 500,
              }}>{SORT_LABEL[s]}</a>
            ))}
          </nav>
        </div>
        {project.contributors.length === 0
          ? <p className="muted">No verified contributors yet — link your account and commit to claim the top spot.</p>
          : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {project.contributors.map((c, i) => (
                <a key={c.login} href={`/profile/${encodeURIComponent(c.login)}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                  <span style={{ width: 28, textAlign: "right", fontWeight: 700, opacity: 0.8 }}>{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                  {c.avatarSeed && <PetSprite seed={c.avatarSeed} box={40} />}
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{c.login}{c.isAi && <span style={{ fontSize: 11, opacity: 0.7 }}> 🤖</span>}</span>
                  {(() => {
                    const stat = { xp: `${fmt(c.xp)} XP`, commits: `${fmt(c.commits)} commits`, lines: `${fmt(c.lines)} lines` } as const;
                    const rest = (["xp", "commits", "lines"] as const).filter((s) => s !== project.sort);
                    return (<>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{stat[project.sort]}</span>
                      <span className="muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, minWidth: 110, textAlign: "right" }}>{rest.map((s) => stat[s]).join(" · ")}</span>
                    </>);
                  })()}
                </a>
              ))}
            </div>
          )}
      </section>

      <section className="card">
        <h2>Add this badge to your README</h2>
        <p className="muted hint">Show your repo's renown leaderboard right where contributors look. Markdown:</p>
        <div style={{ marginTop: 8 }}><Copyable text={badgeMd} /></div>
        <p style={{ marginTop: 12 }}><img src={`${origin}/project/${project.key}/badge.svg`} alt="renown badge preview" /></p>
        <p className="muted" style={{ marginTop: 12 }}>Not earning renown yet? <code>npm install -g @absolutejs/renown</code> → <code>renown link</code>.</p>
      </section>
    </main>
  );
};

const ProjectApp = ({ project, keyParam, origin }: { project: ProjectForUI | null; keyParam: string; origin: string }) =>
  project ? <ProjectBody project={project} origin={origin} /> : <ProjectNotFound keyParam={keyParam} />;

type RenownProjectProps = {
  cssPath?: string;
  project?: ProjectForUI | null;
  keyParam?: string;       // owner/repo, for the not-found state
  origin?: string;
  shareSnippet?: string;
};

export const RenownProject = ({ cssPath, project = null, keyParam = "", origin = "", shareSnippet = "A repo leaderboard for real, meritorious dev work." }: RenownProjectProps) => {
  const key = project?.key ?? keyParam;
  const fullUrl = `${origin}/project/${key}`;
  const title = project ? `${project.key} on Renown · ${project.totals.devs} dev${project.totals.devs === 1 ? "" : "s"}, ${fmt(project.totals.xp)} XP` : `${keyParam} — not on Renown yet`;
  const image = project ? `${origin}/project/${project.key}/og.png` : undefined;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={shareSnippet}
        canonical={fullUrl}
        openGraph={{ title, description: shareSnippet, type: "website", url: fullUrl, image, imageAlt: `${key} on Renown`, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
        twitter={{ card: "summary_large_image", title, description: shareSnippet, image, imageAlt: `${key} on Renown` }}
      />
      <body>
        <ProjectApp project={project} keyParam={key} origin={origin} />
      </body>
    </html>
  );
};
